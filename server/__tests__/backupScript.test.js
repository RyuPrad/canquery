const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const script = path.resolve(__dirname, '../../deploy/canquery-backup.sh');

describe('host backup publication and retention', () => {
    let directory, backups, bin;
    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-backup-'));
        backups = path.join(directory, 'backups');
        bin = path.join(directory, 'bin');
        await fs.mkdir(bin);
        await fs.mkdir(backups);
        const commands = {
            install: '#!/bin/bash\nmkdir -p "${@: -1}"\n',
            runuser: '#!/bin/bash\nshift 3\nexec "$@"\n',
            pg_dump: '#!/bin/bash\nfor arg in "$@"; do case "$arg" in --file=*) target=${arg#--file=};; esac; done\nif [[ ${@: -1} == app && ${TEST_FAIL_APP:-0} == 1 ]]; then exit 1; fi\nif [[ ${@: -1} == app && ${TEST_CORRUPT_APP:-0} == 1 ]]; then printf bad > "$target"; else printf good > "$target"; fi\n',
            pg_restore: '#!/bin/bash\n[[ $(cat "${@: -1}") == good ]]\n',
            df: '#!/bin/bash\nprintf "Filesystem 1B-blocks Used Available Use%% Mounted\\n"\nif [[ ${TEST_LOW_SPACE:-0} == 1 ]]; then printf "test 1000 999 1 100%% /\\n"; else printf "test 1000000000000 1 999999999999 1%% /\\n"; fi\n'
        };
        for (const [name, content] of Object.entries(commands)) {
            await fs.writeFile(path.join(bin, name), content, { mode: 0o755 });
        }
    });
    afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

    async function run(extra = {}) {
        const env = {
            ...process.env, PATH: bin + path.delimiter + process.env.PATH,
            CANQUERY_BACKUP_DIR: backups, CANQUERY_BACKUP_APP_DATABASE: 'app',
            CANQUERY_BACKUP_ANALYTICS_DATABASE: 'analytics', CANQUERY_BACKUP_MIN_FREE_GB: '1', ...extra
        };
        try { return { code: 0, ...await execute('bash', [script], { env }) }; }
        catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    }

    async function oldBackup(prefix, day, ageDays, content = 'good') {
        const name = `${prefix}-202601${day}T000000Z.dump`;
        const file = path.join(backups, name);
        await fs.writeFile(file, content);
        const timestamp = new Date(Date.now() - ageDays * 86400000);
        await fs.utimes(file, timestamp, timestamp);
        return name;
    }

    test('publishes both validated archives without partial files', async () => {
        expect((await run()).code).toBe(0);
        const files = await fs.readdir(backups);
        expect(files).toHaveLength(2);
        expect(files.every(name => name.endsWith('.dump'))).toBe(true);
    });

    test('an application failure still backs up analytics and runs guarded retention', async () => {
        const oldest = await oldBackup('app', '01', 11);
        const older = await oldBackup('app', '02', 10);
        const newest = await oldBackup('app', '03', 9);
        expect((await run({ TEST_FAIL_APP: '1' })).code).toBe(1);
        const files = await fs.readdir(backups);
        expect(files).not.toContain(oldest);
        expect(files).toEqual(expect.arrayContaining([older, newest]));
        expect(files.some(name => name.startsWith('analytics-'))).toBe(true);
        expect(files.some(name => name.endsWith('.partial'))).toBe(false);
    });

    test('an unreadable dump is never published or used to replace valid recovery points', async () => {
        const previous = await oldBackup('app', '01', 12);
        expect((await run({ TEST_CORRUPT_APP: '1' })).code).toBe(1);
        const files = await fs.readdir(backups);
        expect(files.filter(name => name.startsWith('app-'))).toEqual([previous]);
        expect(files.some(name => name.endsWith('.partial'))).toBe(false);
    });

    test('low disk space prevents new dumps and preserves the last valid backup', async () => {
        const previous = await oldBackup('app', '01', 12);
        expect((await run({ TEST_LOW_SPACE: '1' })).code).toBe(1);
        expect(await fs.readdir(backups)).toEqual([previous]);
    });
});
