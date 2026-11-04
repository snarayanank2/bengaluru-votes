import type { APIRoute } from 'astro';
import { sitemapResponse } from '../lib/seo/sitemaps';

export const GET: APIRoute = () => sitemapResponse('en');
