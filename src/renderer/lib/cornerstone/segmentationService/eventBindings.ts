type SegmentationServiceHandlers = {
  onSegmentationEvent: EventListener;
  onSegmentationDataModified: EventListener;
  onAnnotationAutoSave: EventListener;
  onAnnotationHistoryEvent: EventListener;
};

type EventTargetLike = {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

type ToolEvents = {
  SEGMENTATION_MODIFIED: string;
  SEGMENTATION_DATA_MODIFIED: string;
  SEGMENTATION_ADDED: string;
  SEGMENTATION_REMOVED: string;
  SEGMENTATION_REPRESENTATION_MODIFIED: string;
  SEGMENTATION_REPRESENTATION_ADDED: string;
  SEGMENTATION_REPRESENTATION_REMOVED: string;
  ANNOTATION_COMPLETED: string;
  ANNOTATION_MODIFIED: string;
  ANNOTATION_REMOVED: string;
};

function getBindings(
  events: ToolEvents,
  handlers: SegmentationServiceHandlers,
): Array<{ event: string; handler: EventListener }> {
  return [
    { event: events.SEGMENTATION_MODIFIED, handler: handlers.onSegmentationEvent },
    { event: events.SEGMENTATION_DATA_MODIFIED, handler: handlers.onSegmentationEvent },
    { event: events.SEGMENTATION_ADDED, handler: handlers.onSegmentationEvent },
    { event: events.SEGMENTATION_REMOVED, handler: handlers.onSegmentationEvent },
    { event: events.SEGMENTATION_REPRESENTATION_MODIFIED, handler: handlers.onSegmentationEvent },
    { event: events.SEGMENTATION_REPRESENTATION_ADDED, handler: handlers.onSegmentationEvent },
    { event: events.SEGMENTATION_REPRESENTATION_REMOVED, handler: handlers.onSegmentationEvent },
    { event: events.SEGMENTATION_DATA_MODIFIED, handler: handlers.onSegmentationDataModified },
    { event: events.ANNOTATION_COMPLETED, handler: handlers.onAnnotationAutoSave },
    { event: events.ANNOTATION_MODIFIED, handler: handlers.onAnnotationAutoSave },
    { event: events.ANNOTATION_COMPLETED, handler: handlers.onAnnotationHistoryEvent },
    { event: events.ANNOTATION_MODIFIED, handler: handlers.onAnnotationHistoryEvent },
    { event: events.ANNOTATION_REMOVED, handler: handlers.onAnnotationHistoryEvent },
  ];
}

export function registerSegmentationServiceEventBindings(
  eventTargetLike: EventTargetLike,
  events: ToolEvents,
  handlers: SegmentationServiceHandlers,
): void {
  for (const binding of getBindings(events, handlers)) {
    eventTargetLike.addEventListener(binding.event, binding.handler);
  }
}

export function unregisterSegmentationServiceEventBindings(
  eventTargetLike: EventTargetLike,
  events: ToolEvents,
  handlers: SegmentationServiceHandlers,
): void {
  for (const binding of getBindings(events, handlers)) {
    eventTargetLike.removeEventListener(binding.event, binding.handler);
  }
}
