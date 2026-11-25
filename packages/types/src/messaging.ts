export const EXCHANGES = {
  ORDER_EVENTS: 'order_events',
  LOCATION_EVENTS: 'location_events',
  DISPATCH_RETRY: 'dispatch_retry_exchange',
  DLX: 'dlx',
} as const;

export const QUEUES = {
  DISPATCH: 'dispatch_queue',
  DISPATCH_RETRY: 'dispatch_retry_queue',
  ORDER_PROJECTION: 'order_projection_queue',
  REALTIME: 'realtime_queue',
  REALTIME_LOCATION: 'realtime_location_queue',
  DLQ_DISPATCH: 'dlq_dispatch',
  DLQ_REALTIME: 'dlq_realtime',
} as const;

export const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_UPDATED: 'order.status.updated',
  ORDER_ASSIGNED: 'order.assigned',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_DISPATCH_FAILED: 'order.dispatch.failed',
  DISPATCH_RETRY: 'dispatch.retry',
  COURIER_LOCATION_UPDATED: 'courier.location.updated',
} as const;

export const EVENT_VERSIONS = {
  ORDER_CREATED: 1,
  ORDER_STATUS_UPDATED: 1,
  ORDER_ASSIGNED: 1,
  ORDER_CANCELLED: 1,
  ORDER_DISPATCH_FAILED: 1,
  COURIER_LOCATION_UPDATED: 1,
} as const;
