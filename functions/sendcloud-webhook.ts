import {
  CANCELED_STATUSES,
  NO_LABEL_STATUSES,
  SendcloudParcel,
  getAppData,
  getSendcloudSettings,
  getSignatureKey,
  verifySignature,
} from './lib/sendcloud';

export const config: SwellConfig = {
  description: 'Receive Sendcloud parcel status updates',
  route: {
    methods: ['post'],
    public: true,
  },
};

export async function post(req: SwellRequest) {
  const { swell, appId } = req;
  const settings = await getSendcloudSettings(swell);

  const signature = req.headers.get('sendcloud-signature');
  if (!(await verifySignature(req.rawBody, signature, getSignatureKey(settings)))) {
    throw new SwellError('Invalid Sendcloud signature', { status: 401 });
  }

  const payload = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    action?: string;
    timestamp?: number;
    parcel?: SendcloudParcel;
  };

  // integration_connected / integration_updated / ... are not needed
  if (payload.action !== 'parcel_status_changed' || !payload.parcel) {
    return { received: true };
  }

  const parcel = payload.parcel;

  if (!parcel.order_number) {
    return { received: true, order_found: false };
  }

  const orders = await swell.get('/orders', {
    where: { number: parcel.order_number },
    limit: 1,
  });
  const orderId = orders?.results?.[0]?.id;

  if (!orderId) {
    console.log(`Sendcloud: no order found for parcel ${parcel.id} (${parcel.order_number})`);
    return { received: true, order_found: false };
  }

  const order = orders.results[0];
  const appData = getAppData(order, appId);

  // track the first parcel created for the order; a new parcel replaces it only after it was canceled
  if (
    appData.sendcloud_parcel_id &&
    appData.sendcloud_parcel_id !== parcel.id &&
    !CANCELED_STATUSES.includes(appData.sendcloud_status_id)
  ) {
    console.log(`Sendcloud: parcel ${parcel.id} does not match order ${order.number} parcel ${appData.sendcloud_parcel_id}`);
    return { received: true, order_found: true, updated: false };
  }

  // webhooks can arrive out of order; skip anything older than the last applied update
  if (
    payload.timestamp &&
    appData.sendcloud_status_timestamp &&
    payload.timestamp < appData.sendcloud_status_timestamp
  ) {
    console.log(`Sendcloud: skipped out-of-order update for parcel ${parcel.id}`);
    return { received: true, order_found: true, updated: false };
  }

  const statusId = parcel.status?.id;
  const values: Record<string, any> = {
    sendcloud_parcel_id: parcel.id,
    sendcloud_status_id: statusId,
    sendcloud_status: parcel.status?.message,
    sendcloud_tracking_number: parcel.tracking_number || null,
    sendcloud_tracking_url: parcel.tracking_url || null,
    sendcloud_carrier: parcel.carrier?.code || null,
    ...(payload.timestamp && { sendcloud_status_timestamp: payload.timestamp }),
  };

  const isCanceled = statusId !== undefined && CANCELED_STATUSES.includes(statusId);
  const hasLabel =
    Boolean(parcel.tracking_number) &&
    statusId !== undefined &&
    !NO_LABEL_STATUSES.includes(statusId) &&
    !isCanceled;

  if (settings.create_fulfillment !== false && hasLabel && !appData.sendcloud_shipment_id) {
    const shipmentId = await createSwellShipment(swell, order, parcel);
    if (shipmentId) {
      values.sendcloud_shipment_id = shipmentId;
    }
  }

  if (isCanceled && appData.sendcloud_shipment_id) {
    await swell.put(`/shipments/${appData.sendcloud_shipment_id}`, { canceled: true });
    values.sendcloud_shipment_id = null;
    console.log(`Sendcloud: canceled shipment ${appData.sendcloud_shipment_id} for order ${order.number}`);
  }

  await swell.put(`/orders/${order.id}`, req.appValues(values));

  return { received: true, order_found: true, updated: true };
}

async function createSwellShipment(
  swell: SwellAPI,
  order: any,
  parcel: SendcloudParcel,
): Promise<string | null> {
  const items = (order.items || [])
    .filter((item: any) => item.delivery === 'shipment' && item.quantity_shipment_deliverable > 0)
    .map((item: any) => ({
      order_item_id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: item.quantity_shipment_deliverable,
    }));

  if (!items.length) {
    console.log(`Sendcloud: order ${order.number} has nothing left to ship`);
    return null;
  }

  const shipping = order.shipping || {};
  const shipment = await swell.post('/shipments', {
    order_id: order.id,
    items,
    destination: {
      name: shipping.name,
      first_name: shipping.first_name,
      last_name: shipping.last_name,
      address1: shipping.address1,
      address2: shipping.address2,
      city: shipping.city,
      state: shipping.state,
      zip: shipping.zip,
      country: shipping.country,
      phone: shipping.phone,
    },
    carrier: parcel.carrier?.code,
    carrier_name: parcel.carrier?.code,
    service: parcel.shipment?.id ? String(parcel.shipment.id) : undefined,
    service_name: parcel.shipment?.name,
    tracking_code: parcel.tracking_number,
    notes: `Sendcloud parcel ${parcel.id}${parcel.tracking_url ? `: ${parcel.tracking_url}` : ''}`,
  });

  console.log(`Sendcloud: created shipment ${shipment.id} for order ${order.number}`);
  return shipment.id;
}
