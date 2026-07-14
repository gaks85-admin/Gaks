import url from 'url';
import adminStatsHandler from './_admin/stats';
import adminUsersHandler from './_admin/users/index';
import adminUsersActionHandler from './_admin/users/action';
import adminWatchersHandler from './_admin/watchers/index';
import adminWatchersActionHandler from './_admin/watchers/action';
import adminSignalsHandler from './_admin/signals';
import adminHealthHandler from './_admin/health';
import adminSettingsHandler from './_admin/settings';
import adminSendTestAlertHandler from './_admin/send-test-alert';

export default async function handler(req: any, res: any) {
  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';

  if (pathname.endsWith('/stats')) {
    return adminStatsHandler(req, res);
  }
  if (pathname.endsWith('/users/action')) {
    return adminUsersActionHandler(req, res);
  }
  if (pathname.endsWith('/users')) {
    return adminUsersHandler(req, res);
  }
  if (pathname.endsWith('/watchers/action')) {
    return adminWatchersActionHandler(req, res);
  }
  if (pathname.endsWith('/watchers')) {
    return adminWatchersHandler(req, res);
  }
  if (pathname.endsWith('/signals')) {
    return adminSignalsHandler(req, res);
  }
  if (pathname.endsWith('/health')) {
    return adminHealthHandler(req, res);
  }
  if (pathname.endsWith('/settings')) {
    return adminSettingsHandler(req, res);
  }
  if (pathname.endsWith('/send-test-alert')) {
    return adminSendTestAlertHandler(req, res);
  }

  return res.status(404).json({ error: `Not Found: ${pathname}` });
}
