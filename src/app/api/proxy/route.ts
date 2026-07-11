import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return new NextResponse('Missing URL parameter', { status: 400 });
  }

  let targetUrl: string;
  try {
    targetUrl = new URL(urlParam).href;
  } catch (e) {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    const headers = new Headers(response.headers);
    // Strip security headers that block iframes
    headers.delete('x-frame-options');
    headers.delete('content-security-policy');
    headers.delete('content-security-policy-report-only');
    headers.delete('clear-site-data');
    headers.delete('cross-origin-opener-policy');
    headers.delete('cross-origin-embedder-policy');

    const contentType = headers.get('content-type') || '';
    
    // For non-HTML (images, css, js), just pass it through
    if (!contentType.includes('text/html')) {
      return new NextResponse(response.body, {
        status: response.status,
        headers
      });
    }

    let body = await response.text();

    // Inject <base> tag and interception script
    const baseTag = `<base href="${targetUrl}">`;
    const script = `
      <script>
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a');
          if (link && link.href && !link.href.startsWith('javascript:')) {
            e.preventDefault();
            // Redirect top or self through our proxy
            window.location.href = '/api/proxy?url=' + encodeURIComponent(link.href);
          }
        }, true);

        document.addEventListener('submit', function(e) {
          const form = e.target;
          if (form && form.tagName === 'FORM') {
            e.preventDefault();
            const formData = new FormData(form);
            const params = new URLSearchParams(formData).toString();
            let action = form.action || window.location.href;
            const actionUrl = new URL(action, '${targetUrl}');
            if (form.method.toUpperCase() === 'GET') {
              actionUrl.search = actionUrl.search ? actionUrl.search + '&' + params : '?' + params;
              window.location.href = '/api/proxy?url=' + encodeURIComponent(actionUrl.href);
            }
          }
        }, true);
      </script>
    `;

    // Insert after <head> if it exists, otherwise at start
    if (body.match(/<head[^>]*>/i)) {
      body = body.replace(/(<head[^>]*>)/i, `$1${baseTag}${script}`);
    } else {
      body = `${baseTag}${script}${body}`;
    }

    return new NextResponse(body, {
      status: response.status,
      headers
    });
  } catch (error: any) {
    return new NextResponse(`Proxy Error: ${error.message}`, { status: 500 });
  }
}
