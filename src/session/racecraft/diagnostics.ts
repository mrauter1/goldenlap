import type {
  Entry,
  RacecraftDefensiveCandidateRejection,
  RacecraftDefensiveMoveCommitment,
  Session
} from '../model';

function incrementByCode(
  values: Record<string, number> | undefined,
  assign: (next: Record<string, number>) => void,
  code: string
): void {
  const next = values ??
    (Object.create(null) as Record<string, number>);
  next[code] = (next[code] ?? 0) + 1;
  if (!values) assign(next);
}

export function recordRacecraftDeliberation(
  session: Session,
  entry: Entry
): void {
  session.racecraftDeliberations =
    (session.racecraftDeliberations ?? 0) + 1;
  incrementByCode(
    session.racecraftDeliberationsByCar,
    next => {
      session.racecraftDeliberationsByCar = next;
    },
    entry.code
  );
}

export function recordRacecraftPublication(
  session: Session,
  entry: Entry
): void {
  session.racecraftTacticalPublications =
    (session.racecraftTacticalPublications ?? 0) + 1;
  incrementByCode(
    session.racecraftPublicationsByCar,
    next => {
      session.racecraftPublicationsByCar = next;
    },
    entry.code
  );
}

export function recordRacecraftOffSlotPublicationAttempt(
  session: Session
): void {
  session.racecraftOffSlotPublicationAttempts =
    (session.racecraftOffSlotPublicationAttempts ?? 0) + 1;
}

export function recordRacecraftSameSlotReopening(
  session: Session
): void {
  session.racecraftSameSlotReopenings =
    (session.racecraftSameSlotReopenings ?? 0) + 1;
}

export function recordRacecraftNestedResponseEvaluation(
  session: Session
): void {
  session.racecraftNestedResponseEvaluations =
    (session.racecraftNestedResponseEvaluations ?? 0) + 1;
}

export function recordRacecraftDefensiveCandidateRejection(
  session: Session,
  reason: RacecraftDefensiveCandidateRejection
): void {
  const rejections = session.racecraftDefensiveCandidateRejections ??
    (session.racecraftDefensiveCandidateRejections = {});
  rejections[reason] = (rejections[reason] ?? 0) + 1;
}

export function recordRacecraftDefensiveCommitmentAuthored(
  session: Session,
  commitment: RacecraftDefensiveMoveCommitment
): void {
  session.racecraftDefensiveMovesCommitted =
    (session.racecraftDefensiveMovesCommitted ?? 0) + 1;
  const notice = Math.max(
    0,
    (
      commitment.authoredFirstConflictSessionTimeSeconds ??
      commitment.noticeDeadlineSessionTimeSeconds
    ) - commitment.encroachmentStartSessionTimeSeconds
  );
  const noticeByOutcome =
    session.racecraftDefensiveMinimumNoticeSecondsByOutcome ??
    (session.racecraftDefensiveMinimumNoticeSecondsByOutcome = {});
  noticeByOutcome[commitment.authoredOutcome] = Math.min(
    noticeByOutcome[commitment.authoredOutcome] ?? Infinity,
    notice
  );
  if (commitment.authoredFirstAlongsideSessionTimeSeconds != null) {
    const alongside = Math.max(
      0,
      commitment.authoredFirstAlongsideSessionTimeSeconds -
        commitment.encroachmentStartSessionTimeSeconds
    );
    const alongsideByOutcome =
      session.racecraftDefensiveMinimumAlongsideSecondsByOutcome ??
      (session.racecraftDefensiveMinimumAlongsideSecondsByOutcome = {});
    alongsideByOutcome[commitment.authoredOutcome] = Math.min(
      alongsideByOutcome[commitment.authoredOutcome] ?? Infinity,
      alongside
    );
  }
}

export function recordRacecraftDefensiveCommitmentReset(
  session: Session
): void {
  session.racecraftDefensiveMovesResetAtExit =
    (session.racecraftDefensiveMovesResetAtExit ?? 0) + 1;
}
