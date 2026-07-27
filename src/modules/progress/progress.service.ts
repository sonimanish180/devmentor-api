import * as repo from './progress.repository';

export function completeLesson(userId: string, lessonId: string) {
  return repo.completeLesson(userId, lessonId);
}

export function getProgress(userId: string) {
  return repo.getProgress(userId);
}
