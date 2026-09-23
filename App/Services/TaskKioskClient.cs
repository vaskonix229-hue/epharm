using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace CustomerDisplay.Services;

public sealed record TaskKioskItem(
    string Id,
    string Title,
    string BranchName,
    string Priority,
    DateTimeOffset? DueAt,
    string NotificationKey,
    string QrUrl,
    DateTimeOffset ExpiresAt,
    string? LinkId = null)
{
    public override string ToString() => Title;
}

public interface IMerchTaskApi
{
    Task<MerchTaskDto?> GetActiveMerchTaskAsync(
        string pharmacyId,
        string deviceId,
        CancellationToken ct = default);

    Task<bool> AcknowledgeMerchTaskAsync(
        string dispatchId,
        string pharmacyId,
        string deviceId,
        string deliveryToken,
        CancellationToken ct = default);
}

/// <summary>
/// Task queue accessed through ePharm. The POSM client uses its normal device credential;
/// the merchandising integration key remains on the backend.
/// </summary>
public sealed class TaskKioskClient : IDisposable
{
    private readonly IMerchTaskApi _api;
    private readonly string _pharmacyId;
    private readonly string _deviceId;

    public TaskKioskClient(IMerchTaskApi api, string pharmacyId, string deviceId)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _pharmacyId = NormalizeRequired(pharmacyId, nameof(pharmacyId));
        _deviceId = string.IsNullOrWhiteSpace(deviceId)
            ? "posm"
            : NormalizeRequired(deviceId, nameof(deviceId));
    }

    public async Task<List<TaskKioskItem>> ListAsync(CancellationToken cancellation)
    {
        var task = await _api
            .GetActiveMerchTaskAsync(_pharmacyId, _deviceId, cancellation)
            .ConfigureAwait(false);
        if (task == null) return [];

        if (!Uri.TryCreate(task.PublicUrl, UriKind.Absolute, out var qr) ||
            (qr.Scheme != Uri.UriSchemeHttps && !(qr.Scheme == Uri.UriSchemeHttp && qr.IsLoopback)) ||
            string.IsNullOrWhiteSpace(task.DeliveryToken) ||
            string.IsNullOrWhiteSpace(task.Id))
        {
            throw new InvalidOperationException("Invalid task link returned by ePharm.");
        }

        return
        [
            new TaskKioskItem(
                task.Id,
                string.IsNullOrWhiteSpace(task.Title) ? "Задание мерчендайзинга" : task.Title,
                $"Аптека {_pharmacyId}",
                task.Priority ?? "normal",
                task.DueAt,
                task.DeliveryToken,
                qr.AbsoluteUri,
                task.ExpiresAt ?? DateTimeOffset.UtcNow.AddDays(7),
                task.DeliveryToken)
        ];
    }

    public Task<bool> AcknowledgeAsync(TaskKioskItem task, CancellationToken cancellation)
    {
        ArgumentNullException.ThrowIfNull(task);
        return _api.AcknowledgeMerchTaskAsync(
            task.Id,
            _pharmacyId,
            _deviceId,
            task.NotificationKey,
            cancellation);
    }

    // The API is owned and disposed by MainWindow.
    public void Dispose() { }

    private static string NormalizeRequired(string value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException("A non-empty identifier is required.", parameterName);
        var normalized = value.Trim();
        if (normalized.Length > 128 || normalized.IndexOfAny(['\r', '\n', '\0']) >= 0)
            throw new ArgumentException("The identifier is invalid.", parameterName);
        return normalized;
    }
}

public sealed record MerchTaskEnvelope(MerchTaskDto? Task, bool Available = true);

public sealed record MerchTaskDto(
    string Id,
    string Title,
    string? Priority,
    DateTimeOffset? DueAt,
    DateTimeOffset? ExpiresAt,
    string PublicUrl,
    string DeliveryToken);

public sealed record MerchTaskDeliveryResult(bool Accepted, bool Available = true);

public sealed class MerchTaskUnavailableException : Exception
{
    public MerchTaskUnavailableException()
        : base("The optional merchandising task service is temporarily unavailable.") { }
}

/// <summary>
/// Backoff is isolated to the optional merchandising poller. It never changes recommendation,
/// heartbeat, fulfillment, or sales schedules.
/// </summary>
public sealed class TaskKioskPollSchedule
{
    // Assignment delivery tolerates a short delay. A per-poll spread prevents a
    // synchronized fleet restart from exhausting the merchandising DB pool.
    private const double HealthyMinimumSeconds = 24;
    private const double HealthyJitterSeconds = 12;
    private static readonly TimeSpan[] FailureIntervals =
    [
        TimeSpan.FromSeconds(30),
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(2),
        TimeSpan.FromMinutes(5),
    ];

    private int _failureCount;
    private readonly Func<double> _randomSample;

    public TaskKioskPollSchedule(Func<double>? randomSample = null)
    {
        _randomSample = randomSample ?? (() => Random.Shared.NextDouble());
    }

    public TimeSpan Initial => NextHealthyInterval();

    public TimeSpan RecordSuccess()
    {
        _failureCount = 0;
        return NextHealthyInterval();
    }

    public TimeSpan RecordFailure()
    {
        var index = Math.Min(_failureCount, FailureIntervals.Length - 1);
        _failureCount++;
        return FailureIntervals[index];
    }

    private TimeSpan NextHealthyInterval()
    {
        var sample = _randomSample();
        if (!double.IsFinite(sample)) sample = 0.5;
        return TimeSpan.FromSeconds(HealthyMinimumSeconds + HealthyJitterSeconds * Math.Clamp(sample, 0, 1));
    }
}
