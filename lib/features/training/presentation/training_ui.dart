import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../data/training_models.dart';

String trainingFormatLabel(TrainingFormat format) => switch (format) {
      TrainingFormat.online => 'Онлайн',
      TrainingFormat.hybrid => 'Гибридный',
      TrainingFormat.offline => 'Очный',
    };

String assignmentStatusLabel(TrainingAssignmentStatus status) =>
    switch (status) {
      TrainingAssignmentStatus.scheduled => 'Запланировано',
      TrainingAssignmentStatus.notStarted => 'Не начато',
      TrainingAssignmentStatus.inProgress => 'В процессе',
      TrainingAssignmentStatus.waitingOnline => 'Онлайн-этап',
      TrainingAssignmentStatus.waitingTest => 'Ожидает тест',
      TrainingAssignmentStatus.waitingExam => 'Ожидает AI-экзамен',
      TrainingAssignmentStatus.waitingEventSelection => 'Ожидает событие',
      TrainingAssignmentStatus.waitingOffline => 'Ожидает очное обучение',
      TrainingAssignmentStatus.waitingAttendance => 'Ожидает отметку',
      TrainingAssignmentStatus.waitingReview => 'На проверке',
      TrainingAssignmentStatus.retakeRequired => 'Нужна пересдача',
      TrainingAssignmentStatus.completed => 'Завершено',
      TrainingAssignmentStatus.overdue => 'Просрочено',
      TrainingAssignmentStatus.paused => 'Приостановлено',
      TrainingAssignmentStatus.cancelled => 'Отменено',
    };

String stageTypeLabel(TrainingStageType type) => switch (type) {
      TrainingStageType.material => 'Материал',
      TrainingStageType.onlineCourse => 'Онлайн-курс',
      TrainingStageType.test => 'Тест',
      TrainingStageType.aiExam => 'AI-экзамен',
      TrainingStageType.offlineEvent => 'Очное обучение',
      TrainingStageType.manualReview => 'Проверка тренером',
    };

String stageStatusLabel(TrainingStageStatus status) => switch (status) {
      TrainingStageStatus.locked => 'Недоступно',
      TrainingStageStatus.available => 'Доступно',
      TrainingStageStatus.inProgress => 'В процессе',
      TrainingStageStatus.waitingReview => 'На проверке',
      TrainingStageStatus.completed => 'Пройдено',
      TrainingStageStatus.failed => 'Не пройдено',
      TrainingStageStatus.skipped => 'Пропущено',
    };

Color trainingStatusColor(TrainingAssignmentStatus status) => switch (status) {
      TrainingAssignmentStatus.completed => const Color(0xFF2F7D5A),
      TrainingAssignmentStatus.overdue ||
      TrainingAssignmentStatus.retakeRequired ||
      TrainingAssignmentStatus.cancelled =>
        const Color(0xFFB63F3F),
      TrainingAssignmentStatus.scheduled ||
      TrainingAssignmentStatus.paused =>
        AppColors.ink500,
      _ => AppColors.brandGreen700,
    };

Color stageStatusColor(TrainingStageStatus status) => switch (status) {
      TrainingStageStatus.completed ||
      TrainingStageStatus.skipped =>
        const Color(0xFF2F7D5A),
      TrainingStageStatus.failed => const Color(0xFFB63F3F),
      TrainingStageStatus.locked => AppColors.ink400,
      _ => AppColors.brandGreen700,
    };

IconData stageIcon(TrainingStageType type) => switch (type) {
      TrainingStageType.material => Icons.menu_book_rounded,
      TrainingStageType.onlineCourse => Icons.play_circle_outline_rounded,
      TrainingStageType.test => Icons.quiz_outlined,
      TrainingStageType.aiExam => Icons.auto_awesome_outlined,
      TrainingStageType.offlineEvent => Icons.groups_2_outlined,
      TrainingStageType.manualReview => Icons.fact_check_outlined,
    };

String lessonKindLabel(String kind) => switch (kind) {
      'video' => 'Видео',
      'pdf' => 'PDF',
      'presentation' => 'Презентация',
      'image' => 'Изображение',
      'audio' => 'Аудио',
      'link' => 'Ссылка',
      'interactive' => 'Интерактив',
      'quiz' || 'test' => 'Тест',
      'practice' || 'assignment' => 'Задание',
      _ => 'Материал',
    };

IconData lessonKindIcon(String kind) => switch (kind) {
      'video' => Icons.play_circle_outline_rounded,
      'pdf' => Icons.picture_as_pdf_outlined,
      'presentation' => Icons.slideshow_outlined,
      'image' => Icons.image_outlined,
      'audio' => Icons.headphones_outlined,
      'link' => Icons.link_rounded,
      'interactive' => Icons.touch_app_outlined,
      'quiz' || 'test' => Icons.quiz_outlined,
      'practice' || 'assignment' => Icons.assignment_outlined,
      _ => Icons.article_outlined,
    };

IconData lessonAttachmentIcon(TrainingLessonAttachment attachment) {
  if (attachment.kind == 'image' ||
      attachment.contentType.startsWith('image/')) {
    return Icons.image_outlined;
  }
  if (attachment.kind == 'video' ||
      attachment.contentType.startsWith('video/')) {
    return Icons.play_circle_outline_rounded;
  }
  if (attachment.contentType.startsWith('audio/')) {
    return Icons.headphones_outlined;
  }
  if (attachment.contentType == 'application/pdf') {
    return Icons.picture_as_pdf_outlined;
  }
  return Icons.attach_file_rounded;
}

String trainingDate(DateTime? value, {bool withTime = false}) {
  if (value == null) return 'Не указано';
  final day = value.day.toString().padLeft(2, '0');
  final month = value.month.toString().padLeft(2, '0');
  final year = value.year.toString();
  if (!withTime) return '$day.$month.$year';
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '$day.$month.$year, $hour:$minute';
}

String formatKzt(int value) {
  final raw = value.toString();
  final out = StringBuffer();
  for (var index = 0; index < raw.length; index++) {
    if (index > 0 && (raw.length - index) % 3 == 0) out.write(' ');
    out.write(raw[index]);
  }
  return '${out.toString()} ₸';
}
