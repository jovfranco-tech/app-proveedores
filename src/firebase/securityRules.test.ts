import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const firestoreRules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const storageRules = readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8');

describe('Firebase production rules', () => {
  it('deny unknown Firestore and Storage paths by default', () => {
    expect(firestoreRules).toContain('match /{document=**}');
    expect(firestoreRules).toContain('allow read, write: if false');
    expect(storageRules).toContain('match /{allPaths=**}');
    expect(storageRules).toContain('allow read, write: if false');
  });

  it('do not include production-wide allow read/write true rules', () => {
    expect(firestoreRules).not.toMatch(/allow\s+read\s*,\s*write\s*:\s*if\s+true/);
    expect(storageRules).not.toMatch(/allow\s+read\s*,\s*write\s*:\s*if\s+true/);
  });

  it('protect payment and audit collections from normal client writes', () => {
    expect(firestoreRules).toMatch(/match \/payments\/\{paymentId\}[\s\S]*allow write: if isAdmin\(\)/);
    expect(firestoreRules).toMatch(/match \/auditLogs\/\{auditId\}[\s\S]*allow create, update, delete: if false/);
  });

  it('prevents admin self-assignment in user profile creates', () => {
    expect(firestoreRules).toContain("request.resource.data.role in ['cliente', 'proveedor']");
    expect(firestoreRules).toContain('admin is assigned only by custom claims');
  });
});
