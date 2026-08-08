import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('canonical production host redirect', () => {
  it('redirects only the legacy Vercel production hostname to the canonical host', async () => {
    const redirects = await nextConfig.redirects?.();
    const redirect = redirects?.[0];

    expect(redirect).toMatchObject({
      source: '/:path*',
      destination: 'https://arielcharts.donovanyohan.com/:path*',
      permanent: true,
      has: [
        {
          type: 'host',
          value: 'arielcharts\\.vercel\\.app',
        },
      ],
    });

    const hostPattern = redirect?.has?.[0]?.value;
    expect(hostPattern).toBeDefined();

    const matchesHost = (host: string) => new RegExp(`^${hostPattern}$`).test(host.toLowerCase());

    expect(matchesHost('arielcharts.vercel.app')).toBe(true);
    expect(matchesHost('ARIELCHARTS.VERCEL.APP')).toBe(true);
    expect(matchesHost('arielcharts-git-main-donovanyohan.vercel.app')).toBe(false);
    expect(matchesHost('localhost')).toBe(false);
    expect(matchesHost('arielcharts.donovanyohan.com')).toBe(false);
  });
});
