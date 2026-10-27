#!/usr/bin/env python3
"""Fail-closed operational validation. Never print config values or evaluate env files."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
from datetime import datetime, timezone
from urllib.parse import urlsplit, unquote


def require(condition, message):
    if not condition:
        raise ValueError(message)


def private_file(path):
    p = Path(path)
    require(p.is_absolute() and p.is_file() and not p.is_symlink(), 'Use an absolute regular private configuration file (no symlink).')
    info = p.stat()
    require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0, 'Private file must be owned by the operator with no group/other permissions.')
    root = Path(__file__).resolve().parents[2]
    require(not p.resolve().is_relative_to(root), 'Keep private configuration outside the checkout.')
    return p


def literal_env(path):
    values = {}
    for line in private_file(path).read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        require(separator and re.fullmatch(r'[A-Z][A-Z0-9_]*', key), 'Invalid literal backup env file.')
        require(key not in values, 'Duplicate backup setting.')
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
            value = value[1:-1]
        values[key] = value
    return values


def validate_compose(data, project, local=False):
    services, networks = data['services'], data['networks']
    require(services['app']['environment'].get('ALLOW_DM_REGISTRATION') in ('true', 'false'), 'ALLOW_DM_REGISTRATION must be true or false.')
    require(data.get('name') == project, 'Unexpected Compose project.')
    require(set(services) == {'postgres','app','caddy','migrate','asset-archive','asset-restore'}, 'Unexpected services.')
    require(networks['proxy'].get('internal') and networks['database'].get('internal'), 'Proxy and database networks must be internal.')
    require(set(services['app']['networks']) == {'proxy','database'}, 'App network boundary changed.')
    require(set(services['postgres']['networks']) == {'database'}, 'PostgreSQL must be database-only.')
    require(set(services['caddy']['networks']) == {'proxy','edge'}, 'Caddy network boundary changed.')
    for name, service in services.items():
        require(not service.get('privileged') and service.get('network_mode') != 'host', 'Privileged/host-network containers are forbidden.')
        require(not service.get('container_name'), 'Fixed container names break project isolation.')
        if name != 'caddy':
            require(not service.get('ports'), 'Only Caddy may publish ports.')
        for volume in service.get('volumes', []):
            require('docker.sock' not in str(volume), 'Never mount the Docker socket into the stack.')
    for service in services.values():
        environment=service.get('environment',{})
        require(all(environment.get(key)=='' for key in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy')) and environment.get('NO_PROXY')=='*', 'Private traffic must never inherit a client HTTP proxy.')
    ports = services['caddy']['ports']
    require(len(ports) == 2 and {p['target'] for p in ports} == {80,443}, 'Publish only Caddy HTTP/HTTPS.')
    if local:
        require(project.startswith(('ledger-smoke-','ledger-restore-')), 'Local validation needs an isolated project name.')
        require(all(p.get('host_ip') == '127.0.0.1' and int(p['published']) > 1024 for p in ports), 'Local validation must publish only loopback high ports.')
    else:
        require(all(int(p['published']) == p['target'] and p.get('protocol','tcp')=='tcp' for p in ports), 'Production must publish standard HTTP/HTTPS ports.')
    require(all(not n.get('external') and n.get('driver','bridge')=='bridge' and n['name'].startswith(project+'_') for n in networks.values()), 'Use project-private bridge networks.')
    require(services['app'].get('scale',1)==1 and services['app'].get('deploy',{}).get('replicas',1)==1, 'One application instance only.')
    require(services['app'].get('command') in (None,['node','dist-server/server/index.js']), 'App startup must never run migrations.')
    app, db, caddy = services['app'], services['postgres'], services['caddy']
    env, pg, ce = app['environment'], db['environment'], caddy['environment']
    require(app['user'] == '1000:1000' and app.get('read_only') and app.get('init'), 'App must be non-root, read-only and use init.')
    require('ALL' in app.get('cap_drop',[]) and 'no-new-privileges:true' in app.get('security_opt',[]), 'App privilege restrictions missing.')
    require(env['NODE_ENV'] == 'production' and str(env['TRUST_PROXY']) == '1' and str(env['PORT']) == '3001', 'Unexpected app runtime/proxy settings.')
    require(env['ASSET_STORAGE_DIR'] == '/var/lib/encounter-ledger/assets', 'Unexpected private asset directory.')
    secret = env['SESSION_SECRET']
    require(len(secret) >= 32 and not re.match(r'(replace|change|your)', secret, re.I), 'Replace the session secret placeholder.')
    domain = ce['LEDGER_DOMAIN']
    require(re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', domain), 'Invalid public hostname.')
    expected = 'https://localhost:' + next(str(p['published']) for p in ports if p['target'] == 443) if local else 'https://' + domain
    require(env['APP_ORIGIN'] == expected, 'APP_ORIGIN must match the public HTTPS URL exactly.')
    require(domain == 'localhost' if local else domain != 'localhost' and not domain.endswith(('.example.com','.test','.invalid')), 'Choose a real production hostname, or localhost in local test mode.')
    url = urlsplit(env['DATABASE_URL'])
    require(url.scheme in ('postgres','postgresql') and url.hostname == 'postgres' and (url.port or 5432) == 5432, 'Database URL must use the private PostgreSQL service.')
    require(unquote(url.username or '') == pg['POSTGRES_USER'] and unquote(url.password or '') == pg['POSTGRES_PASSWORD'] and unquote(url.path[1:]) == pg['POSTGRES_DB'], 'Database URL credentials/database must match the PostgreSQL service.')
    require(len(pg['POSTGRES_PASSWORD']) >= 32 and not pg['POSTGRES_PASSWORD'].startswith('REPLACE'), 'Use a random database password of at least 32 characters.')
    require(re.fullmatch(r'(?:docker.io/library/)?postgres:17(?:[-.][a-zA-Z0-9_.-]+)?(?:@sha256:[a-f0-9]{64})?', db['image']), 'Use an explicitly tagged PostgreSQL 17 image/digest.')
    body_limit = int(ce['MAX_REQUEST_BODY_BYTES'])
    require(int(env['ASSET_MAX_BYTES']) + 32768 <= body_limit <= 134217728, 'Proxy body cap must accommodate GLB + framing and stay bounded.')
    if not local:
        require(re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', app['image']), 'Production requires a verified immutable application image digest.')
    require(services['migrate']['image'] == app['image'] and services['migrate'].get('profiles') == ['operations'], 'Migrations must be explicit and use the application image.')
    require(services['migrate']['command'] == ['node','dist-server/server/migrate.js'], 'Unexpected migration command.')
    require('migrate' not in app.get('depends_on',{}), 'Never auto-run migrations at app startup.')
    for service in ('asset-archive','asset-restore'):
        require(services[service].get('network_mode') == 'none' and services[service].get('profiles') == ['operations'], 'Asset operations must be isolated explicit jobs.')
    archive = services['asset-archive']['volumes'][0]
    require(archive.get('read_only') is True, 'Backup asset mount must be read-only.')
    for volume in data['volumes'].values():
        require(not volume.get('external') and volume['name'].startswith(project+'_'), 'Volumes must be private to this Compose project.')
    return True


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def manifest(directory, image):
    root = Path(directory)
    data = {'schemaVersion':1,'postgresMajor':17,'image':image,'createdAt':datetime.now(timezone.utc).isoformat(),'files':{}}
    for name in ('database.dump','assets.tar.gz'):
        p = root/name
        require(p.is_file() and p.stat().st_size > 0, 'Backup artifact missing or empty.')
        data['files'][name] = {'sha256':digest(p),'bytes':p.stat().st_size}
    (root/'manifest.json').write_text(json.dumps(data,indent=2)+'\n')


def verify(directory):
    root = Path(directory)
    require(not (root/'manifest.json').is_symlink() and (root/'manifest.json').stat().st_size < 65536, 'Invalid manifest.')
    data = json.loads((root/'manifest.json').read_text())
    require(data['schemaVersion'] == 1 and data['postgresMajor'] == 17, 'Unsupported backup format/database version.')
    require(set(data['files']) == {'database.dump','assets.tar.gz'}, 'Unexpected backup artifacts.')
    for name, meta in data['files'].items():
        p = root/name
        require(p.is_file() and not p.is_symlink() and p.stat().st_size == meta['bytes'] and digest(p) == meta['sha256'], 'Backup artifact checksum/size mismatch.')
    total = 0
    with tarfile.open(root/'assets.tar.gz','r:gz') as archive:
        for index, member in enumerate(archive):
            path = PurePosixPath(member.name)
            require(index < 1000000 and not path.is_absolute() and '..' not in path.parts and not '\\' in member.name, 'Unsafe archive path.')
            require(member.isfile() or member.isdir(), 'Links and special entries are forbidden in asset backups.')
            require(member.mode & 0o7000 == 0, 'Special archive permissions are forbidden.')
            require(member.size >= 0, 'Invalid archive size.')
            total += member.size
            require(total <= int(os.environ.get('RESTORE_MAX_ASSET_BYTES', str(50*1024**3))), 'Archive exceeds the configured restore budget.')
    require(isinstance(data['image'],str) and len(data['image']) < 512, 'Invalid backup image reference.')
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action',choices=['private-file','compose','backup-env','manifest','verify'])
    parser.add_argument('path',nargs='?')
    parser.add_argument('--project');parser.add_argument('--local-test',action='store_true');parser.add_argument('--image')
    args = parser.parse_args()
    if args.action == 'private-file': private_file(args.path)
    elif args.action == 'compose': validate_compose(json.load(sys.stdin),args.project,args.local_test); print('Production configuration checks passed (secrets withheld).')
    elif args.action == 'backup-env':
        allowed = {'RESTIC_REPOSITORY','RESTIC_PASSWORD_FILE','RESTIC_CACHE_DIR','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_DEFAULT_REGION'}
        values = literal_env(args.path)
        require(set(values) <= allowed, 'Unexpected backup environment key.')
        require(all(values.get(k) for k in ('RESTIC_REPOSITORY','RESTIC_PASSWORD_FILE')), 'Backup repository/password file required.')
        password=private_file(values['RESTIC_PASSWORD_FILE'])
        require(len(password.read_text().strip()) >= 32, 'Use a strong, separately stored backup password.')
        require(all('\0' not in v for v in values.values()), 'Invalid backup value.')
        if os.environ.get('LEDGER_LOCAL_TEST') != '1':
            repo=urlsplit(values['RESTIC_REPOSITORY'].removeprefix('s3:'))
            require(values['RESTIC_REPOSITORY'].startswith('s3:https://') and repo.hostname and not repo.username and not repo.password, 'Use an HTTPS off-server S3 repository without inline credentials.')
            require(all(values.get(k) and not values[k].startswith('REPLACE') for k in ('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY')), 'Set scoped off-server credentials.')
        for key,value in values.items(): sys.stdout.buffer.write(key.encode()+b'\0'+value.encode()+b'\0')
    elif args.action == 'manifest': manifest(args.path,args.image)
    elif args.action == 'verify':
        data = verify(args.path)
        if args.image: require(data['image'] == args.image, 'Restore must use the backup application image; rehearse migrations separately.')
        print('Backup integrity and archive safety checks passed.')



if __name__ == '__main__':
    try: main()
    except (ValueError, TypeError, AttributeError, KeyError, OSError, tarfile.TarError, json.JSONDecodeError):
        # Do not print raw exceptions: malformed config can contain credentials.
        print('Operational validation failed. Check private file permissions, configuration, image/origin/network policy or backup integrity.',file=sys.stderr)
        sys.exit(1)
