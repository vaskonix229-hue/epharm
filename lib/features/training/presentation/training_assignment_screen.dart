import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_radii.dart';
import '../../../core/theme/app_shadows.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/error_snackbar.dart';
import '../../../core/widgets/media_image.dart';
import '../../../core/widgets/primary_button.dart';
import '../../profile_pages/presentation/profile_page_scaffold.dart';
import '../application/training_controller.dart';
import '../data/training_models.dart';
import 'training_qr_screen.dart';
import 'training_ui.dart';

class TrainingAssignmentScreen extends ConsumerStatefulWidget {
  const TrainingAssignmentScreen({
    super.key,
    required this.assignmentId,
  });

  final String assignmentId;

  @override
  ConsumerState<TrainingAssignmentScreen> createState() =>
      _TrainingAssignmentScreenState();
}

class _TrainingAssignmentScreenState
    extends ConsumerState<TrainingAssignmentScreen> {
  String? _busyAction;

  @override
  Widget build(BuildContext context) {
    final assignment =
        ref.watch(trainingAssignmentProvider(widget.assignmentId));
    return ProfilePageScaffold(
      title: 'Программа обучения',
      titleSize: 23,
      child: assignment.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _DetailError(
          error: error,
          onRetry: () =>
              ref.invalidate(trainingAssignmentProvider(widget.assignmentId)),
        ),
        data: _buildAssignment,
      ),
    );
  }

  Widget _buildAssignment(TrainingAssignment assignment) {
    final availableEvents =
        assignment.event == null && assignment.format != TrainingFormat.online
            ? ref.watch(availableTrainingEventsProvider(assignment.id))
            : null;
    return RefreshIndicator(
      color: AppColors.brandGreen700,
      onRefresh: () async {
        ref.invalidate(trainingAssignmentProvider(widget.assignmentId));
        await ref.read(trainingAssignmentProvider(widget.assignmentId).future);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.screenEdge,
          0,
          AppSpacing.screenEdge,
          AppSpacing.s32,
        ),
        children: [
          _ProgramSummary(assignment: assignment),
          if (availableEvents != null) ...[
            const SizedBox(height: AppSpacing.s16),
            availableEvents.when(
              loading: () => const _EventLoading(),
              error: (error, _) => _EventLoadError(
                onRetry: () => ref.invalidate(
                  availableTrainingEventsProvider(assignment.id),
                ),
              ),
              data: (events) => _EventSelection(
                events: events,
                busyEventId: _busyAction?.startsWith('event:') == true
                    ? _busyAction!.substring(6)
                    : null,
                onSelect: (event) => _selectEvent(assignment.id, event),
              ),
            ),
          ],
          if (assignment.event != null) ...[
            const SizedBox(height: AppSpacing.s16),
            _EventDetails(
              event: assignment.event!,
              onCheckIn: _busyAction == null ? _scanEventQr : null,
            ),
          ],
          const SizedBox(height: AppSpacing.s24),
          Text('Этапы', style: AppTypography.h3()),
          const SizedBox(height: AppSpacing.s12),
          ...assignment.stages.map(
            (stage) => Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.s8),
              child: _StageRow(
                stage: stage,
                busy: _busyAction == stage.id,
                onOpen: stage.contentUrl == null ||
                        (stage.course?.lessons.isNotEmpty ?? false)
                    ? null
                    : () => _openUrl(stage.contentUrl!),
                onOpenUrl: _openUrl,
                onComplete: stage.isCompletableInApp &&
                        (stage.isAvailable || stage.isInProgress) &&
                        !assignment.isCompleted
                    ? () => _completeStage(assignment, stage)
                    : null,
              ),
            ),
          ),
          if (assignment.isCompleted) ...[
            const SizedBox(height: AppSpacing.s12),
            _CompletionPanel(
              assignment: assignment,
              onCertificate: assignment.certificate?.pdfUrl == null
                  ? null
                  : () => _openUrl(assignment.certificate!.pdfUrl!),
            ),
          ],
          if (assignment.canStart) ...[
            const SizedBox(height: AppSpacing.s20),
            PrimaryButton(
              label: _busyAction == 'start' ? 'Запускаем…' : 'Начать программу',
              onPressed:
                  _busyAction == null ? () => _start(assignment.id) : null,
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _start(String assignmentId) async {
    setState(() => _busyAction = 'start');
    try {
      await ref.read(trainingActionsProvider).start(assignmentId);
    } catch (error) {
      if (mounted) showErrorSnackBar(context, error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _completeStage(
    TrainingAssignment assignment,
    TrainingStage stage,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Завершить этап?'),
        content: Text('Подтвердите, что материал «${stage.title}» изучен.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Завершить'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busyAction = stage.id);
    try {
      final updated = await ref.read(trainingActionsProvider).completeStage(
            assignmentId: assignment.id,
            stageId: stage.id,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            updated.isCompleted ? 'Программа завершена' : 'Этап завершён',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (error) {
      if (mounted) showErrorSnackBar(context, error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _openUrl(String rawUrl) async {
    final uri = Uri.tryParse(ref.read(apiClientProvider).resolveUrl(rawUrl));
    if (uri == null ||
        !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) {
        showErrorSnackBar(context, Exception('Файл не удалось открыть'));
      }
    }
  }

  Future<void> _selectEvent(
    String assignmentId,
    TrainingEvent event,
  ) async {
    setState(() => _busyAction = 'event:${event.id}');
    try {
      await ref.read(trainingActionsProvider).selectEvent(
            assignmentId: assignmentId,
            eventId: event.id,
          );
    } catch (error) {
      if (mounted) showErrorSnackBar(context, error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _scanEventQr() async {
    final assignment = await Navigator.of(context).push<TrainingAssignment>(
      MaterialPageRoute(builder: (_) => const TrainingQrScreen()),
    );
    if (!mounted || assignment == null) return;
    ref.invalidate(trainingAssignmentProvider(widget.assignmentId));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Посещение подтверждено'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

class _ProgramSummary extends StatelessWidget {
  const _ProgramSummary({required this.assignment});

  final TrainingAssignment assignment;

  @override
  Widget build(BuildContext context) {
    final statusColor = trainingStatusColor(assignment.status);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadii.brLg,
        boxShadow: AppShadows.card,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (assignment.coverUrl != null)
            SizedBox(
              height: 170,
              width: double.infinity,
              child: MediaImage(
                url: assignment.coverUrl,
                fit: BoxFit.cover,
                cacheWidth: 1000,
                placeholder: () => const ColoredBox(
                  color: AppColors.brandGreen100,
                  child: Center(
                    child: Icon(Icons.school_outlined,
                        size: 48, color: AppColors.brandGreen700),
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.s20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(assignment.programName, style: AppTypography.h2()),
                if (assignment.shortDescription.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.s8),
                  Text(assignment.shortDescription,
                      style: AppTypography.body14()),
                ],
                const SizedBox(height: AppSpacing.s16),
                Wrap(
                  spacing: AppSpacing.s8,
                  runSpacing: AppSpacing.s8,
                  children: [
                    _Pill(
                      text: trainingFormatLabel(assignment.format),
                      color: AppColors.ink700,
                    ),
                    _Pill(
                      text: assignmentStatusLabel(assignment.status),
                      color: statusColor,
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.s16),
                Row(
                  children: [
                    Text('Прогресс', style: AppTypography.caption()),
                    const Spacer(),
                    Text('${assignment.progressPct}%',
                        style: AppTypography.bodyStrong(color: statusColor)),
                  ],
                ),
                const SizedBox(height: AppSpacing.s8),
                ClipRRect(
                  borderRadius: AppRadii.brFull,
                  child: LinearProgressIndicator(
                    value: assignment.progressPct / 100,
                    minHeight: 9,
                    backgroundColor: AppColors.paperInput,
                    color: statusColor,
                  ),
                ),
                if (assignment.dueAt != null) ...[
                  const SizedBox(height: AppSpacing.s12),
                  Row(
                    children: [
                      const Icon(Icons.schedule_rounded,
                          size: 18, color: AppColors.ink500),
                      const SizedBox(width: AppSpacing.s8),
                      Text('Срок: ${trainingDate(assignment.dueAt)}',
                          style: AppTypography.caption()),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StageRow extends StatelessWidget {
  const _StageRow({
    required this.stage,
    required this.busy,
    required this.onOpen,
    required this.onOpenUrl,
    required this.onComplete,
  });

  final TrainingStage stage;
  final bool busy;
  final VoidCallback? onOpen;
  final ValueChanged<String> onOpenUrl;
  final VoidCallback? onComplete;

  @override
  Widget build(BuildContext context) {
    final color = stageStatusColor(stage.status);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.s16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadii.brLg,
        border: Border.all(color: AppColors.borderHairline),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              stage.status == TrainingStageStatus.completed
                  ? Icons.check_rounded
                  : stageIcon(stage.type),
              color: color,
              size: 22,
            ),
          ),
          const SizedBox(width: AppSpacing.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(stage.title, style: AppTypography.bodyStrong()),
                const SizedBox(height: 2),
                Text(
                  '${stageTypeLabel(stage.type)} · ${stageStatusLabel(stage.status)}',
                  style: AppTypography.caption(color: color),
                ),
                if (stage.passingScore != null) ...[
                  const SizedBox(height: AppSpacing.s4),
                  Text(
                    'Проходной балл ${stage.passingScore}% · попыток ${stage.attemptsUsed}/${stage.maxAttempts ?? '—'}',
                    style: AppTypography.captionSmall(),
                  ),
                ],
                if (stage.score != null) ...[
                  const SizedBox(height: AppSpacing.s4),
                  Text('Результат: ${stage.score}%',
                      style: AppTypography.caption()),
                ],
                if (stage.course != null) ...[
                  const SizedBox(height: AppSpacing.s12),
                  _CourseLessons(
                    course: stage.course!,
                    onOpenUrl: onOpenUrl,
                  ),
                ],
                if (onOpen != null || onComplete != null) ...[
                  const SizedBox(height: AppSpacing.s12),
                  Wrap(
                    spacing: AppSpacing.s8,
                    runSpacing: AppSpacing.s8,
                    children: [
                      if (onOpen != null)
                        SizedBox(
                          height: 40,
                          child: OutlinedButton.icon(
                            onPressed: onOpen,
                            icon:
                                const Icon(Icons.open_in_new_rounded, size: 18),
                            label: const Text('Открыть материал'),
                          ),
                        ),
                      if (onComplete != null)
                        SizedBox(
                          height: 40,
                          child: FilledButton.icon(
                            onPressed: busy ? null : onComplete,
                            icon: busy
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.check_rounded, size: 18),
                            label: Text(
                              busy ? 'Сохраняем…' : 'Подтвердить изучение',
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CourseLessons extends StatelessWidget {
  const _CourseLessons({required this.course, required this.onOpenUrl});

  final TrainingCourseContent course;
  final ValueChanged<String> onOpenUrl;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.s12),
        decoration: BoxDecoration(
          color: AppColors.paperInput,
          borderRadius: AppRadii.brMd,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(course.title, style: AppTypography.bodyStrong()),
            if (course.description.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.s4),
              Text(course.description, style: AppTypography.caption()),
            ],
            if (course.lessons.isEmpty) ...[
              const SizedBox(height: AppSpacing.s8),
              Text(
                'Материалы курса пока не опубликованы',
                style: AppTypography.captionSmall(),
              ),
            ] else ...[
              const SizedBox(height: AppSpacing.s8),
              ...course.lessons.asMap().entries.map((entry) {
                final lesson = entry.value;
                return Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.s8),
                  decoration: BoxDecoration(
                    border: entry.key == 0
                        ? null
                        : const Border(
                            top: BorderSide(color: AppColors.borderHairline),
                          ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            lessonKindIcon(lesson.kind),
                            size: 19,
                            color: AppColors.brandGreen700,
                          ),
                          const SizedBox(width: AppSpacing.s8),
                          Expanded(
                            child: Text(
                              '${entry.key + 1}. ${lesson.title}',
                              style: AppTypography.bodyStrong(),
                            ),
                          ),
                          if (lesson.durationMin > 0)
                            Text(
                              '${lesson.durationMin} мин.',
                              style: AppTypography.captionSmall(),
                            ),
                          if (lesson.requiredLesson)
                            const Padding(
                              padding: EdgeInsets.only(left: AppSpacing.s8),
                              child: Icon(
                                Icons.verified_outlined,
                                size: 16,
                                color: AppColors.brandGreen700,
                              ),
                            ),
                        ],
                      ),
                      if (lesson.description.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.s4),
                        Text(lesson.description,
                            style: AppTypography.caption()),
                      ],
                      const SizedBox(height: AppSpacing.s4),
                      Wrap(
                        spacing: AppSpacing.s8,
                        runSpacing: AppSpacing.s4,
                        children: [
                          Text(
                            lessonKindLabel(lesson.kind),
                            style: AppTypography.captionSmall(
                              color: AppColors.brandGreen700,
                            ),
                          ),
                          if (lesson.minimumWatchPct != null)
                            Text(
                              'Просмотр от ${lesson.minimumWatchPct}%',
                              style: AppTypography.captionSmall(),
                            ),
                          if (!lesson.requiredLesson)
                            Text(
                              'Необязательно',
                              style: AppTypography.captionSmall(),
                            ),
                        ],
                      ),
                      if (lesson.content.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.s8),
                        Text(lesson.content, style: AppTypography.body14()),
                      ],
                      if (lesson.hasVideo) ...[
                        const SizedBox(height: AppSpacing.s8),
                        SizedBox(
                          height: 38,
                          child: OutlinedButton.icon(
                            onPressed: () => onOpenUrl(lesson.videoUrl!),
                            icon: const Icon(
                              Icons.play_arrow_rounded,
                              size: 18,
                            ),
                            label: const Text('Смотреть видео'),
                          ),
                        ),
                      ],
                      if (lesson.hasExternalMaterial) ...[
                        const SizedBox(height: AppSpacing.s8),
                        SizedBox(
                          height: 38,
                          child: OutlinedButton.icon(
                            onPressed: () => onOpenUrl(lesson.externalUrl!),
                            icon:
                                const Icon(Icons.open_in_new_rounded, size: 18),
                            label: Text(
                              lesson.kind == 'interactive'
                                  ? 'Открыть интерактив'
                                  : 'Открыть материал',
                            ),
                          ),
                        ),
                      ],
                      if (lesson.attachments.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.s8),
                        ...lesson.attachments.map(
                          (attachment) => Padding(
                            padding: const EdgeInsets.only(
                              bottom: AppSpacing.s4,
                            ),
                            child: SizedBox(
                              width: double.infinity,
                              height: 38,
                              child: OutlinedButton.icon(
                                onPressed: attachment.mediaUrl.isEmpty
                                    ? null
                                    : () => onOpenUrl(attachment.mediaUrl),
                                icon: Icon(
                                  lessonAttachmentIcon(attachment),
                                  size: 18,
                                ),
                                label: Text(
                                  attachment.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                );
              }),
            ],
          ],
        ),
      );
}

class _EventDetails extends StatelessWidget {
  const _EventDetails({required this.event, required this.onCheckIn});

  final TrainingEvent event;
  final VoidCallback? onCheckIn;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.s16),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF3EA),
          borderRadius: AppRadii.brLg,
          border: Border.all(color: const Color(0x1FD86C3A)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.event_available_outlined,
                    color: AppColors.brandGreen700),
                const SizedBox(width: AppSpacing.s8),
                Expanded(
                    child:
                        Text(event.title, style: AppTypography.bodyStrong())),
              ],
            ),
            const SizedBox(height: AppSpacing.s8),
            Text(trainingDate(event.startsAt, withTime: true),
                style: AppTypography.body14()),
            if (event.city.isNotEmpty || event.address.isNotEmpty)
              Text(
                [event.city, event.address]
                    .where((part) => part.isNotEmpty)
                    .join(', '),
                style: AppTypography.caption(),
              ),
            const SizedBox(height: AppSpacing.s12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: onCheckIn,
                icon: const Icon(Icons.qr_code_scanner_rounded),
                label: const Text('Отметить посещение'),
              ),
            ),
          ],
        ),
      );
}

class _EventSelection extends StatelessWidget {
  const _EventSelection({
    required this.events,
    required this.busyEventId,
    required this.onSelect,
  });

  final List<TrainingEvent> events;
  final String? busyEventId;
  final ValueChanged<TrainingEvent> onSelect;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.s16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: AppRadii.brLg,
          border: Border.all(color: AppColors.borderHairline),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Выбор мероприятия', style: AppTypography.h3()),
            const SizedBox(height: AppSpacing.s12),
            if (events.isEmpty)
              Text(
                'Доступных мероприятий пока нет',
                style: AppTypography.body14(color: AppColors.ink500),
              )
            else
              ...events.map(
                (event) => Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.s8),
                  child: Container(
                    padding: const EdgeInsets.all(AppSpacing.s12),
                    decoration: BoxDecoration(
                      color: AppColors.paperInput,
                      borderRadius: AppRadii.brMd,
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.event_outlined,
                            color: AppColors.brandGreen700),
                        const SizedBox(width: AppSpacing.s8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(event.title,
                                  style: AppTypography.bodyStrong()),
                              Text(
                                trainingDate(event.startsAt, withTime: true),
                                style: AppTypography.caption(),
                              ),
                              if (event.address.isNotEmpty)
                                Text(event.address,
                                    style: AppTypography.captionSmall()),
                            ],
                          ),
                        ),
                        const SizedBox(width: AppSpacing.s8),
                        FilledButton(
                          onPressed: busyEventId == null
                              ? () => onSelect(event)
                              : null,
                          child: busyEventId == event.id
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Text('Выбрать'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      );
}

class _EventLoading extends StatelessWidget {
  const _EventLoading();

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 72,
        child: Center(child: CircularProgressIndicator()),
      );
}

class _EventLoadError extends StatelessWidget {
  const _EventLoadError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.s16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: AppRadii.brLg,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text('Не удалось загрузить мероприятия',
                  style: AppTypography.body14()),
            ),
            IconButton(
              tooltip: 'Повторить',
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
      );
}

class _CompletionPanel extends StatelessWidget {
  const _CompletionPanel(
      {required this.assignment, required this.onCertificate});

  final TrainingAssignment assignment;
  final VoidCallback? onCertificate;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.s20),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF5EF),
          borderRadius: AppRadii.brLg,
        ),
        child: Column(
          children: [
            const Icon(Icons.workspace_premium_rounded,
                size: 44, color: Color(0xFF2F7D5A)),
            const SizedBox(height: AppSpacing.s8),
            Text('Программа завершена',
                style: AppTypography.h3(), textAlign: TextAlign.center),
            if (assignment.score != null)
              Text('Результат ${assignment.score}%',
                  style: AppTypography.body14()),
            if (assignment.reward != null) ...[
              const SizedBox(height: AppSpacing.s8),
              Text(
                '+${formatKzt(assignment.reward!.amount)}',
                style: AppTypography.h2(color: const Color(0xFF2F7D5A)),
              ),
            ],
            if (onCertificate != null) ...[
              const SizedBox(height: AppSpacing.s16),
              OutlinedButton.icon(
                onPressed: onCertificate,
                icon: const Icon(Icons.open_in_new_rounded),
                label: const Text('Открыть сертификат'),
              ),
            ],
          ],
        ),
      );
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: AppRadii.brFull,
        ),
        child: Text(text, style: AppTypography.micro(color: color)),
      );
}

class _DetailError extends StatelessWidget {
  const _DetailError({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(AppSpacing.screenEdge),
        children: [
          const SizedBox(height: AppSpacing.s32),
          Text(messageFromError(error),
              style: AppTypography.body14(), textAlign: TextAlign.center),
          const SizedBox(height: AppSpacing.s16),
          PrimaryButton(label: 'Повторить', onPressed: onRetry),
        ],
      );
}
