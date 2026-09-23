import 'dart:convert';

import 'package:flutter/foundation.dart' show compute;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import 'api_exception.dart';
import 'token_store.dart';

/// Исход попытки refresh:
///  - [ok] — токены обновлены, запрос можно повторить;
///  - [authFailed] — рефреш-токен явно невалиден (сессия мертва, токены очищены);
///  - [transient] — сеть/5xx/битый ответ: сессия МОЖЕТ быть жива, токены НЕ трогаем.
enum _RefreshOutcome { ok, authFailed, transient }

/// Тонкая обёртка над http.Client для backend Epharm.
///
/// Возможности:
///  - префикс baseUrl + JSON-кодирование;
///  - Bearer-токен из TokenStore на защищённых запросах;
///  - endpoint failover на явно настроенный резервный HTTPS origin;
///  - **JWT-refresh interceptor**: на 401 пытается обновить пару через
///    `/api/mobile/auth/refresh` и повторяет запрос один раз. Refresh
///    дедуплицируется (single-flight): конкурентные 401 (напр. /me + /promotions
///    на Home) ждут ОДИН refresh, иначе второй запрос шлёт уже отозванный
///    ротацией refresh-токен и затирает только что выданную валидную пару.
///  - единый разбор ошибок `{code,message}` → ApiException.
class ApiClient {
  ApiClient(
    this._tokenStore, {
    http.Client? client,
    String? baseUrl,
    List<String>? fallbackBaseUrls,
    Duration requestTimeout = const Duration(seconds: 20),
  })  : _client = client ?? http.Client(),
        _baseUrls = _resolveBaseUrls(baseUrl, fallbackBaseUrls),
        _requestTimeout = requestTimeout;

  final http.Client _client;
  final TokenStore _tokenStore;
  final List<String> _baseUrls;
  final Duration _requestTimeout;
  int _activeBaseUrlIndex = 0;

  /// In-flight refresh для дедупликации (single-flight): пока он не null, все
  /// конкурентные 401 переиспользуют ОДИН результат refresh вместо параллельных
  /// попыток, каждая из которых жгла бы одноразовый ротируемый refresh-токен.
  Future<_RefreshOutcome>? _refreshInFlight;

  // ── Публичный API ──────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getJson(String path, {bool auth = true}) async {
    final res = await _sendWithRefresh(
      () => _client.get(_uri(path), headers: _headers(auth: auth)),
      auth: auth,
    );
    return _decode(res);
  }

  /// GET, где тело — JSON-массив (например история чеков).
  Future<List<dynamic>> getJsonList(String path, {bool auth = true}) async {
    final res = await _sendWithRefresh(
      () => _client.get(_uri(path), headers: _headers(auth: auth)),
      auth: auth,
    );
    return _decodeList(res);
  }

  Future<Map<String, dynamic>> postJson(
    String path,
    Object body, {
    bool auth = true,
  }) async {
    final res = await _sendWithRefresh(
      () => _client.post(_uri(path),
          headers: _headers(auth: auth), body: jsonEncode(body)),
      auth: auth,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> patchJson(
    String path,
    Object body, {
    bool auth = true,
  }) async {
    final res = await _sendWithRefresh(
      () => _client.patch(
        _uri(path),
        headers: _headers(auth: auth),
        body: jsonEncode(body),
      ),
      auth: auth,
    );
    return _decode(res);
  }

  /// Превращает относительную backend-ссылку (например PDF-сертификат) в
  /// абсолютную, используя origin, на котором последний запрос реально прошёл.
  String resolveUrl(String rawUrl) {
    final parsed = Uri.tryParse(rawUrl);
    if (parsed != null && parsed.hasScheme) return parsed.toString();
    final path = rawUrl.startsWith('/') ? rawUrl : '/$rawUrl';
    return _uri(path).toString();
  }

  /// Multipart-загрузка (Фаза C — фото чека). file/qr опциональны.
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    Map<String, String> fields = const {},
    List<int>? fileBytes,
    String? fileField,
    String? fileName,
    String? contentTypeSub,
  }) async {
    Future<http.Response> build() async {
      final req = http.MultipartRequest('POST', _uri(path));
      req.headers.addAll(_headers(auth: true, json: false));
      req.fields.addAll(fields);
      if (fileBytes != null && fileField != null) {
        req.files.add(http.MultipartFile.fromBytes(fileField, fileBytes,
            filename: fileName ?? 'receipt.jpg'));
      }
      final streamed = await _client.send(req);
      return http.Response.fromStream(streamed);
    }

    final res = await _sendWithRefresh(build, auth: true);
    return _decode(res);
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  String get _baseUrl => _baseUrls[_activeBaseUrlIndex];

  static List<String> _resolveBaseUrls(
      String? baseUrl, List<String>? fallbackBaseUrls) {
    final primary =
        (baseUrl ?? ApiConfig.baseUrl).trim().replaceFirst(RegExp(r'/+$'), '');
    final fallbacks = fallbackBaseUrls ??
        (baseUrl == null ? ApiConfig.fallbackBaseUrls : const <String>[]);
    final unique = <String>{};
    for (final rawUrl in [primary, ...fallbacks]) {
      final url = rawUrl.trim().replaceFirst(RegExp(r'/+$'), '');
      if (url.isNotEmpty) unique.add(url);
    }
    if (unique.isEmpty) {
      throw ArgumentError.value(
          baseUrl, 'baseUrl', 'At least one backend URL is required');
    }
    return unique.toList(growable: false);
  }

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  Map<String, String> _headers({required bool auth, bool json = true}) {
    final h = <String, String>{};
    if (json) h['Content-Type'] = 'application/json';
    if (auth && _tokenStore.hasTokens) {
      h['Authorization'] = 'Bearer ${_tokenStore.tokens!.accessToken}';
    }
    return h;
  }

  /// Выполняет запрос; на 401 (для авторизованных) — refresh + один повтор.
  /// Повтор пересоздаёт запрос через тот же thunk, поэтому подхватывает свежий токен.
  Future<http.Response> _sendWithRefresh(
    Future<http.Response> Function() request, {
    required bool auth,
  }) async {
    http.Response res;
    try {
      res = await _sendWithFailover(request);
    } catch (_) {
      throw const ApiException.network();
    }
    if (res.statusCode == 401 && auth && _tokenStore.hasTokens) {
      // Single-flight: конкурентные 401 ждут один общий refresh.
      final outcome = await (_refreshInFlight ??=
          _tryRefresh().whenComplete(() => _refreshInFlight = null));
      switch (outcome) {
        case _RefreshOutcome.ok:
          // Повтор пересоздаёт запрос через thunk → подхватывает свежий токен.
          try {
            res = await _sendWithFailover(request);
          } catch (_) {
            throw const ApiException.network();
          }
        case _RefreshOutcome.authFailed:
          // Сессия мертва (_tryRefresh уже очистил токены). Типизированный
          // UNAUTHORIZED, чтобы UI надёжно показал «сессия истекла» даже при
          // пустом теле 401 (иначе _decode кинул бы bare «Ошибка сервера»).
          throw ApiException(
            message: 'Сессия истекла. Войдите снова.',
            code: 'UNAUTHORIZED',
            statusCode: 401,
          );
        case _RefreshOutcome.transient:
          // Сеть/5xx/битый ответ — сессия МОЖЕТ быть жива. НЕ разлогиниваем:
          // бросаем сетевую ошибку, UI покажет «повторить».
          throw const ApiException.network();
      }
    }
    return res;
  }

  /// Переключает origin только при исключении до получения HTTP-ответа (DNS,
  /// TLS, разрыв соединения). Коды backend 4xx/5xx возвращаются как есть и не
  /// повторяются, чтобы не скрывать доменную ошибку и не дублировать операцию.
  Future<http.Response> _sendWithFailover(
    Future<http.Response> Function() request,
  ) async {
    Object? lastError;
    StackTrace? lastStackTrace;

    for (var attempts = 0; attempts < _baseUrls.length; attempts++) {
      try {
        return await request().timeout(_requestTimeout);
      } catch (error, stackTrace) {
        lastError = error;
        lastStackTrace = stackTrace;
        if (_activeBaseUrlIndex >= _baseUrls.length - 1) break;
        _activeBaseUrlIndex++;
      }
    }

    Error.throwWithStackTrace(lastError!, lastStackTrace!);
  }

  /// Пытается обновить пару токенов. Токены очищаются ТОЛЬКО при явном отказе
  /// бэка (рефреш-токен невалиден) — на транзиентных сбоях (сеть/5xx) сессия
  /// сохраняется, чтобы повтор позже подхватил живую сессию (не форсить OTP-релогин).
  Future<_RefreshOutcome> _tryRefresh() async {
    final tokens = _tokenStore.tokens;
    if (tokens == null) return _RefreshOutcome.authFailed;
    final http.Response res;
    try {
      res = await _sendWithFailover(
        () => _client.post(
          _uri('/api/mobile/auth/refresh'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'refreshToken': tokens.refreshToken}),
        ),
      );
    } catch (_) {
      return _RefreshOutcome.transient; // сетевой сбой — токены не трогаем
    }
    if (res.statusCode == 200) {
      try {
        final json = jsonDecode(res.body) as Map<String, dynamic>;
        _tokenStore
            .save(AuthTokens.fromJson(json['tokens'] as Map<String, dynamic>));
        return _RefreshOutcome.ok;
      } catch (_) {
        return _RefreshOutcome.transient; // битый ответ — не затираем сессию
      }
    }
    if (_isDefiniteAuthFailure(res)) {
      _tokenStore.clear(); // рефреш-токен явно невалиден — сессия мертва
      return _RefreshOutcome.authFailed;
    }
    return _RefreshOutcome.transient; // 5xx и неоднозначные — сессию не трогаем
  }

  /// Бэк явно сказал, что рефреш-токен невалиден: 401/403 ИЛИ машинный код
  /// INVALID_REFRESH_TOKEN/USER_NOT_FOUND/PHARMACIST_BLOCKED. 5xx — НЕ сюда.
  bool _isDefiniteAuthFailure(http.Response res) {
    if (res.statusCode == 401 || res.statusCode == 403) return true;
    if (res.statusCode >= 500) return false;
    try {
      final body = jsonDecode(utf8.decode(res.bodyBytes));
      if (body is Map<String, dynamic>) {
        final code = body['code'] as String?;
        return code == 'INVALID_REFRESH_TOKEN' ||
            code == 'USER_NOT_FOUND' ||
            code == 'PHARMACIST_BLOCKED';
      }
    } catch (_) {
      // тело не JSON — не считаем явным отказом
    }
    return false;
  }

  /// Разбор JSON: крупные ответы (каталог/акции/523 аптеки/~640 категорий)
  /// парсим в ФОНОВОМ изоляте через compute — иначе jsonDecode большого тела
  /// блокирует UI-поток на десятки мс (фриз при открытии экрана/pull-to-refresh).
  /// Мелкие тела декодируем синхронно: спавн изолята + сериализация дороже самого
  /// парсинга короткой строки.
  static const _bgDecodeThreshold = 51200; // 50 КБ
  Future<dynamic> _parseBody(String bodyText) {
    if (bodyText.isEmpty) return Future.value(null);
    if (bodyText.length > _bgDecodeThreshold) {
      return compute(jsonDecode, bodyText);
    }
    return Future.value(jsonDecode(bodyText));
  }

  Future<Map<String, dynamic>> _decode(http.Response res) async {
    final ok = res.statusCode >= 200 && res.statusCode < 300;
    final bodyText = utf8.decode(res.bodyBytes);
    final dynamic parsed =
        bodyText.isEmpty ? <String, dynamic>{} : await _parseBody(bodyText);

    if (ok) {
      return parsed is Map<String, dynamic> ? parsed : <String, dynamic>{};
    }
    // Ошибка — пытаемся достать машинный код и сообщение бэкенда.
    if (parsed is Map<String, dynamic>) {
      throw ApiException(
        message: (parsed['message'] as String?) ?? 'Ошибка сервера',
        code: parsed['code'] as String?,
        statusCode: res.statusCode,
      );
    }
    throw ApiException(message: 'Ошибка сервера', statusCode: res.statusCode);
  }

  Future<List<dynamic>> _decodeList(http.Response res) async {
    final ok = res.statusCode >= 200 && res.statusCode < 300;
    final bodyText = utf8.decode(res.bodyBytes);
    final dynamic parsed =
        bodyText.isEmpty ? <dynamic>[] : await _parseBody(bodyText);
    if (ok) return parsed is List ? parsed : <dynamic>[];
    // Ошибка приходит объектом {code,message}.
    if (parsed is Map<String, dynamic>) {
      throw ApiException(
        message: (parsed['message'] as String?) ?? 'Ошибка сервера',
        code: parsed['code'] as String?,
        statusCode: res.statusCode,
      );
    }
    throw ApiException(message: 'Ошибка сервера', statusCode: res.statusCode);
  }
}

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(ref.read(tokenStoreProvider)),
);
