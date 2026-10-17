#!/usr/bin/env python3
"""Oli's scoped invoice client. Python standard library only; no automatic retries."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import sys
from urllib import error, parse, request
import uuid

MAX_BYTES = 5 * 1024 * 1024


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def configuration():
    base = os.environ.get('OLI_API_URL', '').rstrip('/')
    url = parse.urlsplit(base)
    local = url.hostname in ('localhost', '127.0.0.1', '::1')
    if (not url.hostname or url.username or url.password or url.query or url.fragment
            or url.path != '/api/v1/agent'
            or not (url.scheme == 'https' or url.scheme == 'http' and local)):
        raise ValueError('Set OLI_API_URL to the HTTPS /api/v1/agent address shown in Oli Integrations.')
    key = os.environ.get('OLI_API_KEY', '')
    if not re.fullmatch(r'oli_sk_[0-9a-f]{64}', key):
        raise ValueError('Configure OLI_API_KEY in the agent runtime secret manager. Do not paste it into chat.')
    return base, key


def multipart(path):
    mime = {'.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}.get(path.suffix.lower())
    if not mime:
        raise ValueError('Use a fictitious PDF, JPG or PNG invoice.')
    with path.open('rb') as file:
        content = file.read(MAX_BYTES + 1)
    if not content or len(content) > MAX_BYTES:
        raise ValueError('The file must be between 1 byte and 5 MB.')
    boundary = 'oli-' + secrets.token_hex(24)
    name = re.sub(r'[^A-Za-z0-9._-]', '_', path.name)[:200] or 'invoice'
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f'Content-Type: {mime}\r\n\r\n').encode()
    return head + content + f'\r\n--{boundary}--\r\n'.encode(), f'multipart/form-data; boundary={boundary}'


def call(base, key, method, path, body=None, headers=None):
    req = request.Request(base + path, data=body, method=method,
                          headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json',
                                   'User-Agent': 'Oli-Skill/1.0', **(headers or {})})
    opener = request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=60) as response:
            return json.loads(response.read(2 * 1024 * 1024))
    except error.HTTPError as exc:
        # Do not echo arbitrary remote bodies, redirect locations or credentials.
        result = {'error': {'code': f'HTTP_{exc.code}', 'message': 'Oli rejected the request. Check the skill error guidance.'}}
        retry = exc.headers.get('Retry-After')
        if retry and retry.isdigit():
            result['error']['retryAfterSeconds'] = int(retry)
        print(json.dumps(result), file=sys.stderr)
        raise SystemExit(1) from None
    except (error.URLError, TimeoutError, OSError):
        raise ValueError('Transport failed. For uploads, retain the same file and operation key before retrying.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check', help='Verify the connection without submitting an invoice')
    upload = commands.add_parser('upload')
    upload.add_argument('file', type=Path)
    upload.add_argument('--operation-key', required=True, help='UUID retained for all retries of this submission')
    for name in ('status', 'process'):
        commands.add_parser(name).add_argument('invoice_id')
    args = parser.parse_args()
    try:
        base, key = configuration()
        if args.command == 'check':
            result = call(base, key, 'GET', '/me')
        elif args.command == 'upload':
            operation = str(uuid.UUID(args.operation_key))
            payload, content_type = multipart(args.file)
            result = call(base, key, 'POST', '/invoices', payload,
                          {'Content-Type': content_type, 'Idempotency-Key': operation})
        else:
            if not re.fullmatch(r'inv_[A-Za-z0-9-]+', args.invoice_id):
                raise ValueError('Use the invoice ID returned by Oli.')
            path = '/invoices/' + args.invoice_id
            result = call(base, key, 'GET', path) if args.command == 'status' else call(base, key, 'POST', path + '/process', b'')
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError):
        # Validation errors may include user-controlled paths; keep diagnostics bounded.
        print('Check OLI_API_URL, the runtime secret, file type/size, invoice ID and operation UUID. No credentials were printed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
