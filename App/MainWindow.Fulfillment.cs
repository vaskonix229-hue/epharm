using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using CustomerDisplay.Models.Posm;
using CustomerDisplay.Services;

namespace CustomerDisplay
{
    public partial class MainWindow
    {
        private readonly object _fulfillmentSync = new();
        private readonly Dictionary<string, FulfillmentOrder> _fulfillmentOrders = new(StringComparer.Ordinal);
        private readonly HashSet<string> _knownSubmittedOrders = new(StringComparer.Ordinal);
        private CancellationTokenSource? _fulfillmentCts;
        private FulfillmentClient? _fulfillmentClient;
        private FulfillmentCredentialStore? _fulfillmentCredentialStore;
        private FulfillmentOrderCache? _fulfillmentCache;
        private FulfillmentDeviceCredential? _fulfillmentCredential;
        private bool _configuredDeviceCredentialRejected;
        private readonly FulfillmentRetrySchedule _fulfillmentRegistrationRetry = new();
        private readonly PharmacistNoticeCoordinator _pharmacistNotices = new();
        private FulfillmentNoticeWindow? _fulfillmentNotice;
        private FulfillmentQueueWindow? _fulfillmentQueue;
        private readonly Dictionary<string, FulfillmentOrderWindow> _fulfillmentCards = new(StringComparer.Ordinal);
        private System.Windows.Forms.NotifyIcon? _fulfillmentTray;
        private bool _fulfillmentOnline;
        private string? _lastFulfillmentError;
        private DateTimeOffset _lastFulfillmentErrorAt;
        private int _credentialMigrationRestartScheduled;

        private void StartFulfillment()
        {
            if (_posmConfig?.Enabled != true || !_posmConfig.FulfillmentEnabled ||
                string.IsNullOrWhiteSpace(_posmConfig.PharmacyId))
            {
                Log("Интернет-заказы POSM выключены конфигурацией.");
                return;
            }

            try
            {
                _fulfillmentClient = new FulfillmentClient(_posmConfig, Log);
                _fulfillmentCredentialStore = new FulfillmentCredentialStore(_posmConfig.FulfillmentCredentialPath);
                _fulfillmentCache = new FulfillmentOrderCache(
                    _posmConfig.FulfillmentCachePath,
                    _posmConfig.PharmacyId,
                    _posmConfig.ResolveDeviceId());
                foreach (var order in _fulfillmentCache.Load().Where(x => x.IsActive))
                {
                    _fulfillmentOrders[order.OrderId] = order;
                    if (order.Status == "submitted") _knownSubmittedOrders.Add(order.OrderId);
                }
                CreateFulfillmentTray();
                _fulfillmentCts = new CancellationTokenSource();
                _ = Task.Run(() => FulfillmentLoopAsync(_fulfillmentCts.Token));
                Log($"Интернет-заказы POSM запущены: poll={_posmConfig.FulfillmentPollSec}с, " +
                    $"backend={string.Join(" -> ", _posmConfig.GetFulfillmentBaseUris())}, " +
                    $"кэш={_posmConfig.FulfillmentCachePath}");
            }
            catch (Exception ex)
            {
                Log($"Интернет-заказы POSM не запущены: {ex.GetBaseException().Message}");
            }
        }

        private async Task FulfillmentLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                await PollFulfillmentAsync(ct).ConfigureAwait(false);
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(_posmConfig?.FulfillmentPollSec ?? 10), ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            }
        }

        private async Task PollFulfillmentAsync(CancellationToken ct)
        {
            if (_fulfillmentClient == null || _posmConfig == null) return;
            var credential = await EnsureFulfillmentCredentialAsync(ct).ConfigureAwait(false);
            if (credential == null) return;

            var submitted = await LoadAllFulfillmentOrdersAsync(credential.Token, "submitted", ct).ConfigureAwait(false);
            if (!submitted.IsSuccess || submitted.Value == null)
            {
                HandleFulfillmentFailure(submitted);
                return;
            }
            var active = await LoadAllFulfillmentOrdersAsync(credential.Token, "active", ct).ConfigureAwait(false);
            if (!active.IsSuccess || active.Value == null)
            {
                HandleFulfillmentFailure(active);
                return;
            }

            List<FulfillmentOrder> newOrders;
            lock (_fulfillmentSync)
            {
                newOrders = submitted.Value
                    .Where(x => !_knownSubmittedOrders.Contains(x.OrderId))
                    .Take(20)
                    .ToList();
                foreach (var order in submitted.Value) _knownSubmittedOrders.Add(order.OrderId);
                _fulfillmentOrders.Clear();
                foreach (var order in active.Value) _fulfillmentOrders[order.OrderId] = order;
                _fulfillmentCache?.Save(_fulfillmentOrders.Values);
                _fulfillmentOnline = true;
            }

            var activeIds = active.Value.Select(x => x.OrderId).ToHashSet(StringComparer.Ordinal);
            var openIds = await Dispatcher.InvokeAsync(() => _fulfillmentCards.Keys
                .Where(id => !activeIds.Contains(id))
                .ToList());
            var terminalCards = new List<FulfillmentOrder>();
            foreach (var orderId in openIds)
            {
                var actual = await _fulfillmentClient.GetAsync(credential.Token, orderId, ct).ConfigureAwait(false);
                if (actual.IsSuccess && actual.Value != null) terminalCards.Add(actual.Value);
            }

            await Dispatcher.InvokeAsync(() =>
            {
                foreach (var order in terminalCards)
                {
                    if (_fulfillmentCards.TryGetValue(order.OrderId, out var card))
                        card.Update(order, online: true);
                }
                RefreshFulfillmentWindows();
                if (newOrders.Count > 0) ShowFulfillmentNotice(newOrders.Count);
            });
        }

        private async Task<FulfillmentApiResult<List<FulfillmentOrder>>> LoadAllFulfillmentOrdersAsync(
            string token,
            string status,
            CancellationToken ct)
        {
            const int pageSize = 50;
            const int maxPages = 200;
            var orders = new List<FulfillmentOrder>();
            for (var pageNumber = 0; pageNumber < maxPages; pageNumber++)
            {
                var page = await _fulfillmentClient!.ListAsync(
                    token,
                    status,
                    pageNumber * pageSize,
                    pageSize,
                    ct).ConfigureAwait(false);
                if (!page.IsSuccess || page.Value == null)
                {
                    return new FulfillmentApiResult<List<FulfillmentOrder>>
                    {
                        StatusCode = page.StatusCode,
                        Message = page.Message,
                    };
                }
                orders.AddRange(page.Value.Items);
                if (!page.Value.HasMore)
                {
                    return new FulfillmentApiResult<List<FulfillmentOrder>>
                    {
                        Value = orders,
                        StatusCode = HttpStatusCode.OK,
                    };
                }
                if (page.Value.Items.Count == 0)
                {
                    return new FulfillmentApiResult<List<FulfillmentOrder>>
                    {
                        StatusCode = HttpStatusCode.BadGateway,
                        Message = "Сервер вернул пустую страницу с признаком продолжения.",
                    };
                }
            }
            return new FulfillmentApiResult<List<FulfillmentOrder>>
            {
                StatusCode = HttpStatusCode.BadGateway,
                Message = "Очередь заказов превышает безопасный предел загрузки.",
            };
        }

        private async Task<FulfillmentDeviceCredential?> EnsureFulfillmentCredentialAsync(CancellationToken ct)
        {
            if (_fulfillmentClient == null || _fulfillmentCredentialStore == null || _posmConfig == null) return null;
            var deviceId = _posmConfig.ResolveDeviceId();
            var pharmacyId = _posmConfig.PharmacyId.Trim();
            _fulfillmentCredential ??= _fulfillmentCredentialStore.Load(deviceId, pharmacyId);
            if (_fulfillmentCredential != null) return _fulfillmentCredential;

            // Production DeviceKey is already the individually provisioned POSM token and is
            // accepted by both recommendation and fulfillment APIs. Try it once before invoking
            // the transitional fleet-key registration endpoint used by old pilot installs.
            if (!_configuredDeviceCredentialRejected && _posmConfig.DeviceKey.Trim().Length >= 32)
            {
                _fulfillmentCredential = new FulfillmentDeviceCredential
                {
                    DeviceId = deviceId,
                    PharmacyId = pharmacyId,
                    Token = _posmConfig.DeviceKey.Trim(),
                };
                return _fulfillmentCredential;
            }

            var now = DateTimeOffset.UtcNow;
            if (!_fulfillmentRegistrationRetry.CanAttempt(now)) return null;

            var registration = await _fulfillmentClient.RegisterAsync(deviceId, pharmacyId, ct).ConfigureAwait(false);
            if (!registration.IsSuccess || registration.Value == null)
            {
                var configurationBlocked = registration.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.ServiceUnavailable;
                var retryIn = _fulfillmentRegistrationRetry.RecordFailure(now, configurationBlocked);
                HandleFulfillmentFailure(registration);
                Log($"Повтор регистрации интернет-заказов через {retryIn.TotalSeconds:0}с.");
                return null;
            }
            _fulfillmentCredential = new FulfillmentDeviceCredential
            {
                DeviceId = registration.Value.DeviceId,
                PharmacyId = registration.Value.PharmacyId,
                Token = registration.Value.Token,
            };
            _fulfillmentCredentialStore.Save(_fulfillmentCredential);
            _fulfillmentRegistrationRetry.Reset();
            Log($"Устройство интернет-заказов зарегистрировано: device={deviceId}, pharmacy={pharmacyId}");
            ScheduleRestartAfterCredentialMigration();
            return _fulfillmentCredential;
        }

        /// <summary>
        /// Регистрация выполняется уже после создания recommendation/sales/heartbeat клиентов.
        /// Однократный restart сразу поднимает весь POSM с новым DPAPI-ключом; без него текущий
        /// процесс продолжал бы отправлять рекомендации со старым fleet key до ручного перезапуска.
        /// На следующем старте credential resolver найдёт сохранённый ключ, поэтому цикла нет.
        /// </summary>
        private void ScheduleRestartAfterCredentialMigration()
        {
            if (Interlocked.Exchange(ref _credentialMigrationRestartScheduled, 1) != 0) return;
            Dispatcher.BeginInvoke(new Action(() =>
            {
                try
                {
                    var executable = Environment.ProcessPath;
                    if (string.IsNullOrWhiteSpace(executable))
                        throw new InvalidOperationException("Не удалось определить путь POSM executable.");
                    Log("Индивидуальный ключ сохранён. Выполняется однократный перезапуск POSM.");
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(executable)
                    {
                        UseShellExecute = true,
                        WorkingDirectory = AppContext.BaseDirectory,
                    });
                    Application.Current.Shutdown();
                }
                catch (Exception ex)
                {
                    Interlocked.Exchange(ref _credentialMigrationRestartScheduled, 0);
                    Log($"Не удалось автоматически перезапустить POSM после регистрации: {ex.GetBaseException().Message}");
                }
            }));
        }

        private void HandleFulfillmentFailure<T>(FulfillmentApiResult<T> result)
        {
            lock (_fulfillmentSync) _fulfillmentOnline = false;
            if (result.IsUnauthorized)
            {
                if (_posmConfig != null && _fulfillmentCredential?.Token == _posmConfig.DeviceKey.Trim())
                    _configuredDeviceCredentialRejected = true;
                _fulfillmentCredentialStore?.Delete();
                _fulfillmentCredential = null;
            }
            var key = result.StatusCode?.ToString() + ":" + result.Message;
            if (key != _lastFulfillmentError || DateTimeOffset.UtcNow - _lastFulfillmentErrorAt > TimeSpan.FromMinutes(5))
            {
                _lastFulfillmentError = key;
                _lastFulfillmentErrorAt = DateTimeOffset.UtcNow;
                Log($"Интернет-заказы временно недоступны: {result.Message ?? result.StatusCode?.ToString() ?? "сеть"}");
            }
            Dispatcher.BeginInvoke(new Action(RefreshFulfillmentWindows));
        }

        private void CreateFulfillmentTray()
        {
            Dispatcher.Invoke(() =>
            {
                _fulfillmentTray = new System.Windows.Forms.NotifyIcon
                {
                    Icon = System.Drawing.SystemIcons.Application,
                    Text = "Epharm — интернет-заказы",
                    Visible = true,
                };
                var menu = new System.Windows.Forms.ContextMenuStrip();
                menu.Items.Add("Открыть очередь", null, (_, _) => Dispatcher.BeginInvoke(new Action(ShowFulfillmentQueue)));
                _fulfillmentTray.ContextMenuStrip = menu;
                _fulfillmentTray.DoubleClick += (_, _) => Dispatcher.BeginInvoke(new Action(ShowFulfillmentQueue));
            });
        }

        private List<FulfillmentOrder> FulfillmentSnapshot()
        {
            lock (_fulfillmentSync) return _fulfillmentOrders.Values.Where(x => x.IsActive).ToList();
        }

        private void ShowFulfillmentNotice(int count)
        {
            if (!_pharmacistNotices.TryShowFulfillment(count, out var visibleCount))
            {
                Log($"Уведомление о заказе отложено до закрытия рекомендации: новых={count}.");
                return;
            }

            _fulfillmentNotice?.Close();
            var notice = new FulfillmentNoticeWindow(visibleCount, PharmacistScreen());
            notice.OpenQueueRequested += () =>
            {
                _pharmacistNotices.FulfillmentDismissed();
                ShowFulfillmentQueue();
            };
            notice.LaterRequested += () =>
            {
                _pharmacistNotices.FulfillmentDismissed();
                Log("Уведомление о заказе скрыто; заказ остаётся в очереди.");
            };
            notice.Closed += (_, _) => { if (ReferenceEquals(_fulfillmentNotice, notice)) _fulfillmentNotice = null; };
            _fulfillmentNotice = notice;
            try
            {
                notice.Show();
                _fulfillmentTray?.ShowBalloonTip(4000, "Epharm", visibleCount == 1 ? "Новый интернет-заказ" : $"Новых заказов: {visibleCount}", System.Windows.Forms.ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                if (ReferenceEquals(_fulfillmentNotice, notice)) _fulfillmentNotice = null;
                _pharmacistNotices.FulfillmentDismissed();
                Log($"Уведомление о новом заказе не удалось открыть: {ex.GetBaseException().Message}; заказ остаётся в очереди.");
            }
        }

        private void BeginRecommendationNotice()
        {
            _pharmacistNotices.RecommendationStarting();
            _fulfillmentNotice?.Close();
            _fulfillmentNotice = null;
        }

        private void EndRecommendationNotice()
        {
            var pending = _pharmacistNotices.RecommendationClosed();
            if (pending > 0) ShowFulfillmentNotice(pending);
        }

        private void ShowFulfillmentQueue()
        {
            if (_fulfillmentQueue == null)
            {
                var queue = new FulfillmentQueueWindow(PharmacistScreen());
                queue.OpenOrderRequested += ShowFulfillmentOrder;
                queue.RefreshRequested += () => _ = Task.Run(() => PollFulfillmentAsync(_fulfillmentCts?.Token ?? CancellationToken.None));
                queue.Closed += (_, _) => { if (ReferenceEquals(_fulfillmentQueue, queue)) _fulfillmentQueue = null; };
                _fulfillmentQueue = queue;
            }
            RefreshFulfillmentWindows();
            if (!_fulfillmentQueue.IsVisible) _fulfillmentQueue.Show();
            _fulfillmentQueue.Activate();
        }

        private void ShowFulfillmentOrder(FulfillmentOrder order)
        {
            if (_fulfillmentCards.TryGetValue(order.OrderId, out var existing))
            {
                existing.Update(order, _fulfillmentOnline);
                existing.Activate();
                return;
            }
            var card = new FulfillmentOrderWindow(order, _fulfillmentOnline, PharmacistScreen(), ExecuteFulfillmentActionAsync);
            card.OrderChanged += ApplyFulfillmentOrder;
            card.Closed += (_, _) => _fulfillmentCards.Remove(order.OrderId);
            _fulfillmentCards[order.OrderId] = card;
            card.Show();
        }

        private async Task<FulfillmentApiResult<FulfillmentOrder>> ExecuteFulfillmentActionAsync(
            FulfillmentOrder current,
            FulfillmentActionRequest action)
        {
            if (_fulfillmentClient == null || _fulfillmentCredential == null || !_fulfillmentOnline)
                return new FulfillmentApiResult<FulfillmentOrder> { Message = "Нет связи с сервером." };

            var ct = _fulfillmentCts?.Token ?? CancellationToken.None;
            var result = await _fulfillmentClient.ActAsync(_fulfillmentCredential.Token, current.OrderId, action, ct).ConfigureAwait(false);
            if (result.IsSuccess && result.Value != null)
            {
                await Dispatcher.InvokeAsync(() => ApplyFulfillmentOrder(result.Value));
                return result;
            }

            if (result.IsConflict || result.IsTransportFailure)
            {
                var actual = await _fulfillmentClient.GetAsync(_fulfillmentCredential.Token, current.OrderId, ct).ConfigureAwait(false);
                if (actual.IsSuccess && actual.Value != null && (result.IsConflict || actual.Value.Version > action.ExpectedVersion))
                {
                    await Dispatcher.InvokeAsync(() => ApplyFulfillmentOrder(actual.Value));
                    return actual;
                }
            }
            if (result.IsUnauthorized)
            {
                _fulfillmentCredentialStore?.Delete();
                _fulfillmentCredential = null;
                lock (_fulfillmentSync) _fulfillmentOnline = false;
            }
            return result;
        }

        private void ApplyFulfillmentOrder(FulfillmentOrder order)
        {
            lock (_fulfillmentSync)
            {
                if (order.IsActive) _fulfillmentOrders[order.OrderId] = order;
                else _fulfillmentOrders.Remove(order.OrderId);
                _fulfillmentCache?.Save(_fulfillmentOrders.Values);
            }
            RefreshFulfillmentWindows();
        }

        private void RefreshFulfillmentWindows()
        {
            var snapshot = FulfillmentSnapshot();
            _fulfillmentQueue?.UpdateState(snapshot, _fulfillmentOnline);
            foreach (var pair in _fulfillmentCards.ToList())
            {
                var order = snapshot.FirstOrDefault(x => x.OrderId == pair.Key);
                if (order != null) pair.Value.Update(order, _fulfillmentOnline);
            }
        }

        private void StopFulfillment()
        {
            try
            {
                _fulfillmentCts?.Cancel();
                _fulfillmentNotice?.Close();
                _fulfillmentQueue?.Close();
                foreach (var window in _fulfillmentCards.Values.ToList()) window.Close();
                _fulfillmentTray?.Dispose();
                _fulfillmentClient?.Dispose();
                _fulfillmentCts?.Dispose();
            }
            catch { }
        }
    }
}
