import { readFileSync } from 'fs';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';

export interface Message {
    role: Role;
    content: string;
    timestamp: string;
}

export class Session {
    key: string;
    messages: Message[] = [];
    updatedAt: Date;

    constructor(public id: string) {
        this.key = id;
        this.updatedAt = new Date();
    }

    addMessage(role: Role, content: string) {
        this.messages.push({
            role,
            content,
            timestamp: new Date().toISOString(),
        });
        this.updatedAt = new Date();
    }

    getHistory(max = 50) {
        const recent = this.messages.slice(-max);
        return recent.map(({ role, content }) => ({ role, content }));
    }

    clear() {
        this.messages = [];
        this.updatedAt = new Date();
    }
}

export class SessionManager {
    private dir: string;

    constructor(sessionDir?: string) {
        this.dir = sessionDir || join(require('os').homedir(), '.roxy', 'sessions');
    }

    private async ensureDir() {
        await mkdir(this.dir, { recursive: true });
    }

    private encodeKey(key: string) {
        return key.replace(/[^a-z0-9]/gi, '_') + '.jsonl';
    }

    getOrCreate(key: string): Session {
        const file = join(this.dir, this.encodeKey(key));
        try {
            const content = readFileSync(file, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            const session = new Session(key);
            session.messages = lines.map(line => JSON.parse(line));
            if (session.messages.length) {
                session.updatedAt = new Date(session.messages[session.messages.length - 1].timestamp);
            }
            return session;
        } catch {
            return new Session(key);
        }
    }

    async save(session: Session): Promise<void> {
        await this.ensureDir();
        const file = join(this.dir, this.encodeKey(session.key));
        const lines = session.messages.map(m => JSON.stringify(m));
        await writeFile(file, lines.join('\n'), 'utf-8');
    }

    async delete(key: string): Promise<boolean> {
        try {
            await unlink(join(this.dir, this.encodeKey(key)));
            return true;
        } catch {
            return false;
        }
    }
}