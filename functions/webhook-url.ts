import { getSendcloudSettings, getWebhookUrl } from './lib/sendcloud';

export const config: SwellConfig = {
  description: 'Show the webhook URL in app settings',
  cron: {
    schedule: '*/5 * * * *',
  },
};

export default async function (req: SwellRequest) {
  const { swell, store, appId } = req;
  const settings = await getSendcloudSettings(swell);
  const webhookUrl = getWebhookUrl(store.id, appId);

  if (settings.webhook_url === webhookUrl) {
    return;
  }

  // read-only field in app settings, copied by the merchant into the Sendcloud integration
  await swell.put('/settings/sendcloud', { sendcloud: { webhook_url: webhookUrl } });
  console.log(`Sendcloud: webhook URL set to ${webhookUrl}`);
}
