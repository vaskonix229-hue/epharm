import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pharmacy/features/auth/application/auth_controller.dart';
import 'package:pharmacy/features/auth/domain/user.dart';
import 'package:pharmacy/features/training/application/training_controller.dart';
import 'package:pharmacy/features/training/data/training_models.dart';
import 'package:pharmacy/features/training/presentation/training_screen.dart';

class _LoggedInUser extends CurrentUserNotifier {
  @override
  User? build() => const User(
        fio: 'Айжан Фармацевт',
        phone: '+7 (700) 000-00-01',
        iin: '900101400001',
      );
}

const _assignment = TrainingAssignment(
  id: 'assignment-1',
  programId: 'program-1',
  programVersion: 1,
  programName: 'Безопасная рекомендация продукта',
  shortDescription: 'Онлайн-курс и итоговый тест',
  coverUrl: null,
  pharmacyName: 'Аптека Ауэзова 134',
  city: 'Алматы',
  format: TrainingFormat.online,
  status: TrainingAssignmentStatus.waitingOnline,
  priority: TrainingPriority.normal,
  required: true,
  event: null,
  startsAt: null,
  dueAt: null,
  progressPct: 25,
  score: null,
  startedAt: null,
  completedAt: null,
  stages: <TrainingStage>[],
  certificate: null,
  reward: null,
);

const _overview = TrainingOverview(
  total: 1,
  inProgress: 1,
  completed: 0,
  overdue: 0,
  upcomingEvents: <TrainingEvent>[],
  assignments: <TrainingAssignment>[_assignment],
  certificates: <TrainingCertificate>[],
  notifications: <TrainingNotification>[],
  defaultFormat: TrainingFormat.online,
);

const _notification = TrainingNotification(
  id: 'notification-1',
  eventType: 'training_deadline_24h',
  title: 'Срок обучения истекает',
  message: 'Завершите программу до завтра',
  assignmentId: 'assignment-1',
  eventId: null,
  read: false,
  scheduledAt: null,
  readAt: null,
);

void main() {
  testWidgets('training screen shows live assignment instead of stub',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(_LoggedInUser.new),
          trainingOverviewProvider.overrideWith((ref) async => _overview),
        ],
        child: const MaterialApp(home: TrainingScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Безопасная рекомендация продукта'), findsOneWidget);
    expect(find.text('Онлайн-курс и итоговый тест'), findsOneWidget);
    expect(find.text('Онлайн-этап'), findsOneWidget);
    expect(find.text('Обучение скоро'), findsNothing);
  });

  testWidgets('unauthenticated pharmacist sees login action', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: TrainingScreen()),
      ),
    );

    expect(find.text('Войдите, чтобы открыть обучение'), findsOneWidget);
    expect(find.text('Войти'), findsOneWidget);
  });

  testWidgets('training screen renders internal reminders', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(_LoggedInUser.new),
          trainingOverviewProvider.overrideWith(
            (ref) async => const TrainingOverview(
              total: 1,
              inProgress: 1,
              completed: 0,
              overdue: 0,
              upcomingEvents: <TrainingEvent>[],
              assignments: <TrainingAssignment>[_assignment],
              certificates: <TrainingCertificate>[],
              notifications: <TrainingNotification>[_notification],
              defaultFormat: TrainingFormat.online,
            ),
          ),
        ],
        child: const MaterialApp(home: TrainingScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Уведомления'), findsOneWidget);
    expect(find.text('Срок обучения истекает'), findsOneWidget);
    expect(find.text('Завершите программу до завтра'), findsOneWidget);
  });

  testWidgets('training screen filters programs without a server round-trip',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(_LoggedInUser.new),
          trainingOverviewProvider.overrideWith((ref) async => _overview),
        ],
        child: const MaterialApp(home: TrainingScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'несуществующая');
    await tester.pump();

    expect(find.text('Безопасная рекомендация продукта'), findsNothing);
    expect(find.text('По вашему запросу ничего не найдено'), findsOneWidget);

    await tester.tap(find.byTooltip('Очистить поиск'));
    await tester.pump();
    expect(find.text('Безопасная рекомендация продукта'), findsOneWidget);
  });
}
