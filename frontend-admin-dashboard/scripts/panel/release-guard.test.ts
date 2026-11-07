import { describe, expect, it } from 'vitest';
import { findReleaseProblems } from './release-guard.mjs';

describe('findReleaseProblems', () => {
    it('passes a clean chunk', () => {
        const clean = 'fetch("https://backend-stage.example/x");var a="http://www.w3.org/2000/svg"';
        expect(findReleaseProblems(clean)).toEqual([]);
    });

    it.each([
        ['the legacy login path', '"/auth-service/v1/login-root"', 'legacy-login'],
        ['a loopback backend', 'x="http://127.0.0.1:8760"', 'private-backend'],
        ['localhost', 'x="http://localhost:8072/x"', 'private-backend'],
        ['a private range', 'x="http://192.168.1.20:8072"', 'private-backend'],
        ['a 10.x host', 'x="https://10.0.0.5"', 'private-backend'],
        ['a 172.16 host', 'x="http://172.16.4.2:80"', 'private-backend'],
    ])('refuses %s', (_name, source, kind) => {
        expect(findReleaseProblems(source).map((problem) => problem.kind)).toContain(kind);
    });
});
