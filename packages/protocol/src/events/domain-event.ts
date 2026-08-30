import { z } from "zod";

import { ActionFailedEventSchema } from "./action-failed.event";
import { AgentNeedChangedEventSchema } from "./agent-need-changed.event";
import { DecisionAcceptedEventSchema } from "./decision-accepted.event";
import { DecisionRequestedEventSchema } from "./decision-requested.event";
import { InteractionArbitratedEventSchema } from "./interaction-arbitrated.event";
import { ObjectStateChangedEventSchema } from "./object-state-changed.event";
import { ObservationRememberedEventSchema } from "./observation-remembered.event";
import { WorldReleasedEventSchema } from "./world-released.event";

export const DomainEventSchema = z.discriminatedUnion("type", [
  DecisionRequestedEventSchema,
  DecisionAcceptedEventSchema,
  WorldReleasedEventSchema,
  InteractionArbitratedEventSchema,
  ObjectStateChangedEventSchema,
  AgentNeedChangedEventSchema,
  ActionFailedEventSchema,
  ObservationRememberedEventSchema,
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
