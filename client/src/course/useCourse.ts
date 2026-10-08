import { create } from 'zustand';
import { COURSE, type Chapter, type Step } from '@loadbearing/shared';
import { api, type CourseProgress } from '../lib/api';

/**
 * Where a learner is in the course. Progress lives on the server, which only
 * records a pass its own judge agrees with; this mirrors it for the screens.
 */

export type StepState = 'done' | 'next' | 'open' | 'locked';

interface CourseState {
  progress: CourseProgress['steps'];
  loaded: boolean;
  stepId: string | null;
  load: () => Promise<void>;
  open: (stepId: string) => void;
  /** After the server accepted a pass. */
  passed: (progress: CourseProgress['steps']) => void;
}

export const useCourse = create<CourseState>((set) => ({
  progress: {},
  loaded: false,
  stepId: null,
  load: async () => {
    try {
      const { steps } = await api.courseProgress();
      set({ progress: steps, loaded: true });
    } catch {
      // Left unloaded, so the path shows no count rather than a wrong one.
    }
  },
  open: (stepId) => set({ stepId }),
  passed: (progress) => set({ progress }),
}));

const isDone = (progress: CourseProgress['steps'], step: Step) => Boolean(progress[step.id]);

/** A chapter opens when the one before it has its checkpoint passed. */
export function chapterOpen(chapter: Chapter, progress: CourseProgress['steps']): boolean {
  const i = COURSE.indexOf(chapter);
  if (i <= 0) return true;
  const before = COURSE[i - 1]!;
  return isDone(progress, before.steps[before.steps.length - 1]!);
}

/** Steps open one after another inside an open chapter. */
export function stepState(step: Step, progress: CourseProgress['steps']): StepState {
  const chapter = COURSE.find((c) => c.id === step.chapter)!;
  if (isDone(progress, step)) return 'done';
  if (!chapterOpen(chapter, progress)) return 'locked';
  const i = chapter.steps.indexOf(step);
  const before = chapter.steps[i - 1];
  if (before && !isDone(progress, before)) return 'locked';
  return nextStep(progress)?.id === step.id ? 'next' : 'open';
}

/** The first step not yet passed, in course order. */
export function nextStep(progress: CourseProgress['steps']): Step | undefined {
  return COURSE.flatMap((c) => c.steps).find((s) => !isDone(progress, s));
}

/** The step after this one, if it is open once this one is passed. */
export function stepAfter(step: Step): Step | undefined {
  const all = COURSE.flatMap((c) => c.steps);
  return all[all.indexOf(step) + 1];
}

export const STEP_KIND: Record<Step['type'], string> = {
  'fill-gap': 'Fill the gap',
  'fix-wiring': 'Fix the wiring',
  'find-bottleneck': 'Find the bottleneck',
  'kill-switch': 'Survive a crash',
  'tune-dial': 'Tune a dial',
  checkpoint: 'Checkpoint',
};

/** Rule ids, said the way a goal is: what should be true, in a few words. */
export const RULE_GOAL: Record<string, string> = {
  'client-direct-to-datastore': 'The phone does not touch the database',
  'lb-without-backends': 'The balancer has two boxes behind it',
  'orphan-node': 'Every part is connected',
  'stateful-single-replica': 'Nothing important exists only once',
  'cache-as-system-of-record': 'Orders are saved in the database',
  'cdn-behind-app': 'The CDN sits in front',
  'queue-without-consumer': 'Something reads the queue',
  'queue-without-dlq': 'Bad messages have somewhere to go',
};
