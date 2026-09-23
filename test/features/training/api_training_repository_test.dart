import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pharmacy/core/network/api_client.dart';
import 'package:pharmacy/core/network/token_store.dart';
import 'package:pharmacy/features/training/data/api_training_repository.dart';
import 'package:pharmacy/features/training/data/training_models.dart';

ApiTrainingRepository _repository(MockClient httpClient) =>
    ApiTrainingRepository(
      ApiClient(
        TokenStore()
          ..save(
            const AuthTokens(accessToken: 'access', refreshToken: 'refresh'),
          ),
        baseUrl: 'http://training.test',
        client: httpClient,
      ),
    );

Map<String, dynamic> _assignmentJson({
  String status = 'waiting_online',
  int progress = 25,
}) =>
    <String, dynamic>{
      'id': 'assignment-1',
      'programId': 'program-1',
      'programVersionId': 'version-1',
      'programVersion': 2,
      'programName': 'Работа с продуктом',
      'programShortDescription': 'Курс и итоговая проверка',
      'pharmacistId': 'ph-1',
      'pharmacistName': 'Айжан Фармацевт',
      'pharmacyName': 'Аптека Ауэзова 134',
      'city': 'Алматы',
      'format': 'hybrid',
      'status': status,
      'priority': 'high',
      'required': true,
      'event': <String, dynamic>{
        'id': 'event-1',
        'title': 'Очный тренинг',
        'startsAt': '2026-08-10T05:00:00Z',
        'endsAt': '2026-08-10T07:00:00Z',
        'timezone': 'Asia/Almaty',
        'city': 'Алматы',
        'address': 'Ауэзова 134',
        'status': 'scheduled',
      },
      'dueAt': '2026-08-20T18:00:00Z',
      'progressPct': progress,
      'stages': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'stage-1',
          'programStageId': 'definition-1',
          'key': 'online',
          'type': 'online_course',
          'title': 'Онлайн-курс',
          'order': 0,
          'required': true,
          'status': 'available',
          'progressPct': progress,
          'attemptsUsed': 0,
          'contentUrl': 'https://epharm.inkar.kz/s3/lesson.mp4',
          'course': <String, dynamic>{
            'id': 'course-1',
            'title': 'Основы категории',
            'description': 'Курс с видеоуроками',
            'durationMin': 12,
            'lessons': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'lesson-1',
                'title': 'Введение',
                'description': 'Первый урок',
                'content': 'Изучите основные понятия.',
                'kind': 'video',
                'videoUrl': 'https://epharm.inkar.kz/s3/lesson.mp4',
                'externalUrl': 'https://epharm.inkar.kz/materials/lesson-1',
                'required': true,
                'minimumWatchPct': 80,
                'attachments': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 'attachment-1',
                    'title': 'Памятка фармацевта',
                    'fileName': 'handout.pdf',
                    'contentType': 'application/pdf',
                    'mediaUrl': '/media/handout.pdf',
                    'sizeBytes': 2048,
                    'kind': 'document',
                  },
                ],
                'durationMin': 12,
                'order': 0,
                'createdAt': '2026-08-01T10:00:00Z',
                'updatedAt': '2026-08-01T10:00:00Z',
              },
            ],
          },
        },
        <String, dynamic>{
          'id': 'stage-2',
          'programStageId': 'definition-2',
          'key': 'test',
          'type': 'test',
          'title': 'Итоговый тест',
          'order': 1,
          'required': true,
          'status': 'locked',
          'progressPct': 0,
          'attemptsUsed': 0,
          'maxAttempts': 3,
          'passingScore': 80,
        },
      ],
      'createdAt': '2026-08-01T10:00:00Z',
      'updatedAt': '2026-08-01T10:00:00Z',
    };

http.Response _jsonResponse(Object body) => http.Response(
      jsonEncode(body),
      200,
      headers: const {'content-type': 'application/json; charset=utf-8'},
    );

void main() {
  test('overview parses assignments, events, certificate and default format',
      () async {
    final repository = _repository(MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/mobile/training');
      expect(request.headers['Authorization'], 'Bearer access');
      return _jsonResponse(<String, dynamic>{
        'total': 1,
        'inProgress': 1,
        'completed': 0,
        'overdue': 0,
        'upcomingEvents': [_assignmentJson()['event']],
        'assignments': [_assignmentJson()],
        'certificates': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'certificate-1',
            'number': 'EPH-2026-001',
            'assignmentId': 'assignment-1',
            'programName': 'Работа с продуктом',
            'format': 'hybrid',
            'issuedAt': '2026-08-01T10:00:00Z',
            'score': 92,
            'status': 'valid',
            'pdfUrl': 'https://epharm.inkar.kz/certificate.pdf',
          },
        ],
        'notifications': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'notification-1',
            'eventType': 'training_deadline_24h',
            'title': 'Срок обучения истекает',
            'message': 'Завершите программу до завтра',
            'assignmentId': 'assignment-1',
            'eventId': null,
            'read': false,
            'scheduledAt': '2026-08-19T18:00:00Z',
            'readAt': null,
          },
        ],
        'defaultFormat': 'hybrid',
      });
    }));

    final overview = await repository.loadOverview();
    expect(overview.total, 1);
    expect(overview.defaultFormat, TrainingFormat.hybrid);
    expect(overview.assignments.single.status,
        TrainingAssignmentStatus.waitingOnline);
    expect(overview.assignments.single.stages.first.type,
        TrainingStageType.onlineCourse);
    expect(overview.assignments.single.stages.first.course?.title,
        'Основы категории');
    expect(
        overview.assignments.single.stages.first.course?.lessons.single.title,
        'Введение');
    expect(
        overview.assignments.single.stages.first.course?.lessons.single.isVideo,
        isTrue);
    expect(
      overview.assignments.single.stages.first.course?.lessons.single
          .hasExternalMaterial,
      isTrue,
    );
    expect(
      overview.assignments.single.stages.first.course?.lessons.single
          .minimumWatchPct,
      80,
    );
    final attachment = overview.assignments.single.stages.first.course?.lessons
        .single.attachments.single;
    expect(attachment?.title, 'Памятка фармацевта');
    expect(attachment?.mediaUrl, '/media/handout.pdf');
    expect(overview.upcomingEvents.single.address, 'Ауэзова 134');
    expect(overview.certificates.single.score, 92);
    expect(overview.notifications.single.id, 'notification-1');
    expect(overview.notifications.single.read, isFalse);
  });

  test('start uses authenticated POST endpoint', () async {
    final repository = _repository(MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path,
          '/api/mobile/training/assignments/assignment-1/start');
      expect(request.headers['Authorization'], 'Bearer access');
      return _jsonResponse(_assignmentJson());
    }));

    final assignment = await repository.startAssignment('assignment-1');
    expect(assignment.id, 'assignment-1');
  });

  test('stage completion sends progress only and never client-provided score',
      () async {
    final repository = _repository(MockClient((request) async {
      expect(request.method, 'PATCH');
      expect(
        request.url.path,
        '/api/mobile/training/assignments/assignment-1/stages/stage-1',
      );
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body, <String, dynamic>{'progressPct': 100});
      expect(body.containsKey('score'), isFalse);
      return _jsonResponse(
        _assignmentJson(status: 'waiting_test', progress: 50),
      );
    }));

    final assignment = await repository.updateStageProgress(
      assignmentId: 'assignment-1',
      stageId: 'stage-1',
      progressPct: 100,
    );
    expect(assignment.status, TrainingAssignmentStatus.waitingTest);
  });

  test('notification read uses authenticated PATCH endpoint', () async {
    final repository = _repository(MockClient((request) async {
      expect(request.method, 'PATCH');
      expect(
        request.url.path,
        '/api/mobile/training/notifications/notification-1/read',
      );
      expect(request.headers['Authorization'], 'Bearer access');
      expect(jsonDecode(request.body), isEmpty);
      return _jsonResponse(<String, dynamic>{
        'id': 'notification-1',
        'eventType': 'training_deadline_24h',
        'title': 'Срок обучения истекает',
        'message': 'Завершите программу до завтра',
        'assignmentId': 'assignment-1',
        'eventId': null,
        'read': true,
        'scheduledAt': '2026-08-19T18:00:00Z',
        'readAt': '2026-08-19T18:01:00Z',
      });
    }));

    final notification =
        await repository.markNotificationRead('notification-1');
    expect(notification.read, isTrue);
    expect(notification.readAt, isNotNull);
  });
}
