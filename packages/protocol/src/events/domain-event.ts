import { z } from "zod";

import { ActionFailedEventSchema } from "./action-failed.event";
import { AgentNeedChangedEventSchema } from "./agent-need-changed.event";
import { DecisionAcceptedEventSchema } from "./decision-accepted.event";
import { DecisionRequestedEventSchema } from "./decision-requested.event";
import { InteractionArbitratedEventSchema } from "./interaction-arbitrated.event";
import { ObjectStateChangedEventSchema } from "./object-state-changed.event";
import { ObservationRememberedEventSchema } from "./observation-remembered.event";
import { OperationStartedEventSchema } from "./operation-started.event";
import { OperationTerminatedEventSchema } from "./operation-terminated.event";
import { PerceptibleResultEmittedEventSchema } from "./perceptible-result-emitted.event";
import { PerceptionRecordedEventSchema } from "./perception-recorded.event";
import { WorldReleasedEventSchema } from "./world-released.event";

export const DomainEventSchema = z.discriminatedUnion("type", [
  DecisionRequestedEventSchema,
  DecisionAcceptedEventSchema,
  WorldReleasedEventSchema,
  InteractionArbitratedEventSchema,
  ObjectStateChangedEventSchema,
  AgentNeedChangedEventSchema,
  ActionFailedEventSchema,
  OperationStartedEventSchema,
  OperationTerminatedEventSchema,
  ObservationRememberedEventSchema,
  PerceptionRecordedEventSchema,
  PerceptibleResultEmittedEventSchema,
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
