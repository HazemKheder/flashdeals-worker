import { handleValidate } from '@flashdeals/crawler';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleValidate(request);
}
