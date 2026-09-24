import { z } from 'zod';
export const serviceSettingsSchema = z.object({
  version: z.literal(1),
  pins: z.array(z.string().max(4096)).max(1000),
});
export type ServiceSettings = z.infer<typeof serviceSettingsSchema>;
export type ServiceSnapshot = { settings: ServiceSettings; revision: string };
