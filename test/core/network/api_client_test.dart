import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pharmacy/core/network/api_client.dart';
import 'package:pharmacy/core/network/api_exception.dart';
import 'package:pharmacy/core/network/token_store.dart';

http.Response _json(Object body, int status) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json; charset=utf-8'});

void main() {
  group('ApiClient', () {
    test('postJson возвращает map на 200', () async {
      final store = TokenStore();
      final client = ApiClient(
        store,
        baseUrl: 'http://t',
        client: MockClient((req) async {
          expect(req.url.path, '/x');
          expect(jsonDecode(req.body), {'a': 1});
          return _json({'ok': true}, 200);
        }),
      );
      final res = await client.postJson('/x', {'a': 1}, auth: false);
      expect(res['ok'], true);
    });

    test('зависший запрос завершается понятной сетевой ошибкой', () async {
      final client = ApiClient(
        TokenStore(),
        baseUrl: 'http://t',
        requestTimeout: const Duration(milliseconds: 10),
        client: MockClient((req) async {
          await Future<void>.delayed(const Duration(milliseconds: 100));
          return _json({'ok': true}, 200);
        }),
      );

      await expectLater(
        () => client.getJson('/slow', auth: false),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'message',
            'Ошибка сети. Проверьте подключение и попробуйте ещё раз.',
          ),
        ),
      );
    });

    test('сетевая ошибка HTTPS → повтор через резервный HTTPS origin',
        () async {
      final requestedOrigins = <String>[];
      final client = ApiClient(
        TokenStore(),
        baseUrl: 'https://epharm.inkar.kz',
        fallbackBaseUrls: const ['https://backup.epharm.inkar.kz'],
        client: MockClient((req) async {
          requestedOrigins.add(req.url.origin);
          if (req.url.host == 'epharm.inkar.kz') {
            throw http.ClientException('TLS handshake failed');
          }
          return _json({'ok': true}, 200);
        }),
      );

      final response = await client.postJson('/api/mobile/auth/request-otp', {},
          auth: false);
      expect(response['ok'], true);
      expect(requestedOrigins, [
        'https://epharm.inkar.kz',
        'https://backup.epharm.inkar.kz',
      ]);

      // Успешный fallback становится активным для следующих запросов сессии.
      await client.getJson('/api/mobile/promotions', auth: false);
      expect(requestedOrigins.last, 'https://backup.epharm.inkar.kz');
      expect(
        client.resolveUrl('/api/public/training/certificates/token/pdf'),
        'https://backup.epharm.inkar.kz/api/public/training/certificates/token/pdf',
      );
      expect(
        client.resolveUrl('https://cdn.example.kz/certificate.pdf'),
        'https://cdn.example.kz/certificate.pdf',
      );
    });

    test('HTTP-ошибка backend не переключает origin', () async {
      final requestedOrigins = <String>[];
      final client = ApiClient(
        TokenStore(),
        baseUrl: 'https://epharm.inkar.kz',
        fallbackBaseUrls: const ['https://backup.epharm.inkar.kz'],
        client: MockClient((req) async {
          requestedOrigins.add(req.url.origin);
          return _json(
              {'code': 'VALIDATION_FAILED', 'message': 'Проверьте номер'}, 400);
        }),
      );

      await expectLater(
        () => client.postJson('/api/mobile/auth/request-otp', {}, auth: false),
        throwsA(
            isA<ApiException>().having((e) => e.statusCode, 'statusCode', 400)),
      );
      expect(requestedOrigins, ['https://epharm.inkar.kz']);
    });

    test(
        'основной и резервный HTTPS origin недоступны → сетевая ошибка без цикла',
        () async {
      final requestedOrigins = <String>[];
      final client = ApiClient(
        TokenStore(),
        baseUrl: 'https://epharm.inkar.kz',
        fallbackBaseUrls: const ['https://backup.epharm.inkar.kz'],
        client: MockClient((req) async {
          requestedOrigins.add(req.url.origin);
          throw http.ClientException('endpoint unavailable');
        }),
      );

      await expectLater(
        () => client.getJson('/api/mobile/promotions', auth: false),
        throwsA(
          isA<ApiException>()
              .having((e) => e.code, 'code', isNull)
              .having((e) => e.statusCode, 'statusCode', isNull),
        ),
      );
      expect(requestedOrigins, [
        'https://epharm.inkar.kz',
        'https://backup.epharm.inkar.kz',
      ]);
    });

    test('ошибка с {code,message} → ApiException с кодом', () async {
      final client = ApiClient(
        TokenStore(),
        baseUrl: 'http://t',
        client: MockClient((req) async =>
            _json({'code': 'OTP_INVALID', 'message': 'Неверный код'}, 400)),
      );
      expect(
        () => client.postJson('/v', {}, auth: false),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'OTP_INVALID')
            .having((e) => e.message, 'message', 'Неверный код')),
      );
    });

    test('401 на авторизованном запросе → refresh + повтор с новым токеном',
        () async {
      final store = TokenStore()
        ..save(const AuthTokens(accessToken: 'old', refreshToken: 'r1'));
      var meCalls = 0;
      final client = ApiClient(
        store,
        baseUrl: 'http://t',
        client: MockClient((req) async {
          if (req.url.path == '/api/mobile/auth/refresh') {
            return _json({
              'tokens': {'accessToken': 'new', 'refreshToken': 'r2'}
            }, 200);
          }
          meCalls++;
          if (meCalls == 1) {
            expect(req.headers['Authorization'], 'Bearer old');
            return http.Response('', 401);
          }
          // Повтор уже с обновлённым токеном.
          expect(req.headers['Authorization'], 'Bearer new');
          return _json({'name': 'X'}, 200);
        }),
      );
      final res = await client.getJson('/me');
      expect(res['name'], 'X');
      expect(store.tokens!.accessToken, 'new');
      expect(meCalls, 2);
    });

    test('401 + неудачный refresh → токены очищены, 401 пробрасывается',
        () async {
      final store = TokenStore()
        ..save(const AuthTokens(accessToken: 'old', refreshToken: 'bad'));
      final client = ApiClient(
        store,
        baseUrl: 'http://t',
        client: MockClient((req) async {
          if (req.url.path == '/api/mobile/auth/refresh') {
            return http.Response('', 401);
          }
          return _json({'message': 'Не авторизован'}, 401);
        }),
      );
      await expectLater(
        () => client.getJson('/me'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
      );
      expect(store.hasTokens, false);
    });

    test(
        '401 с {code:UNAUTHORIZED} на getJsonList → типизированный ApiException, не «Ошибка сервера»',
        () async {
      // История чеков (тело-массив). Бэк волны 1 отдаёт security-ошибку как
      // объект {code,message}. _decodeList должен распарсить его даже когда
      // ожидался List, и НЕ свалиться в bare «Ошибка сервера».
      final client = ApiClient(
        TokenStore(),
        baseUrl: 'http://t',
        client: MockClient((req) async =>
            _json({'code': 'UNAUTHORIZED', 'message': 'Требуется вход'}, 401)),
      );
      await expectLater(
        () => client.getJsonList('/api/mobile/receipts', auth: false),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'UNAUTHORIZED')
            .having((e) => e.statusCode, 'status', 401)
            .having((e) => e.message, 'message', isNot('Ошибка сервера'))),
      );
    });

    test(
        '401 с ПУСТЫМ телом + неудачный refresh → ApiException(code UNAUTHORIZED, 401)',
        () async {
      // Корневая прод-причина: бэк отдаёт 401 с пустым телом. Раньше _decodeList
      // кидал bare «Ошибка сервера». Теперь _sendWithRefresh после неуспешного
      // refresh бросает типизированную ошибку с кодом UNAUTHORIZED.
      final store = TokenStore()
        ..save(const AuthTokens(accessToken: 'old', refreshToken: 'bad'));
      final client = ApiClient(
        store,
        baseUrl: 'http://t',
        client: MockClient((req) async {
          if (req.url.path == '/api/mobile/auth/refresh') {
            return http.Response('', 401);
          }
          return http.Response('', 401); // пустое тело
        }),
      );
      await expectLater(
        () => client.getJsonList('/api/mobile/receipts'),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'UNAUTHORIZED')
            .having((e) => e.statusCode, 'status', 401)
            .having((e) => e.message, 'message', isNot('Ошибка сервера'))),
      );
      expect(store.hasTokens, false);
    });

    test(
        '401 + ТРАНЗИЕНТНЫЙ сбой refresh (5xx) → сессия СОХРАНЕНА, сетевая ошибка',
        () async {
      // Ревью-баг #3: раньше любой неуспех refresh чистил токены → ложный OTP-релогин
      // при временном сбое сети/сервера. Теперь на 5xx токены НЕ трогаем.
      final store = TokenStore()
        ..save(const AuthTokens(accessToken: 'old', refreshToken: 'r1'));
      final client = ApiClient(
        store,
        baseUrl: 'http://t',
        client: MockClient((req) async {
          if (req.url.path == '/api/mobile/auth/refresh') {
            return http.Response('', 503);
          }
          return http.Response('', 401);
        }),
      );
      await expectLater(
        () => client.getJson('/me'),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', isNull)), // сетевая, не UNAUTHORIZED
      );
      expect(store.hasTokens, true); // сессия НЕ затёрта
      expect(store.tokens!.refreshToken, 'r1');
    });

    test('конкурентные 401 → ОДИН refresh (single-flight), оба повторяются',
        () async {
      // Ревью-баг #2: два параллельных запроса (напр. /me + /promotions) на Home,
      // оба ловят 401 → раньше делали 2 независимых refresh, второй слал уже
      // отозванный ротацией токен и затирал свежую пару → ложный разлогин.
      final store = TokenStore()
        ..save(const AuthTokens(accessToken: 'old', refreshToken: 'r1'));
      var refreshCalls = 0;
      final client = ApiClient(
        store,
        baseUrl: 'http://t',
        client: MockClient((req) async {
          if (req.url.path == '/api/mobile/auth/refresh') {
            refreshCalls++;
            await Future<void>.delayed(const Duration(milliseconds: 40));
            return _json({
              'tokens': {'accessToken': 'new', 'refreshToken': 'r2'}
            }, 200);
          }
          return req.headers['Authorization'] == 'Bearer new'
              ? _json({'ok': true}, 200)
              : http.Response('', 401);
        }),
      );
      final results =
          await Future.wait([client.getJson('/a'), client.getJson('/b')]);
      expect(refreshCalls, 1); // refresh выполнен РОВНО один раз на оба запроса
      expect(results.every((r) => r['ok'] == true), true);
      expect(store.tokens!.accessToken, 'new');
    });
  });
}
