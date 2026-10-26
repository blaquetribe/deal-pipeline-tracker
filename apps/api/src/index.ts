import { serve } from '@hono/node-server';

import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig(process.env);

serve({ fetch: createApp().fetch, port: config.PORT }, (info) => {
  console.log(`api listening on :${info.port.toString()}`);
});
