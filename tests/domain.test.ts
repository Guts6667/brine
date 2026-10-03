import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityInputSchema, aiResults, aiTestInputSchema, backupSchema, companyDetailsSchema,
  companyInputSchema, dateSchema, dueStatus, formatDate, hasProfessionalContact, isEligible,
  isValidDate, nextActionInputSchema, normalizedDomain, normalizeText, parisToday, qualify,
} from '../lib/domain';
import type { Answer, Backup, Company, Contact } from '../lib/types';
import { emptyQualification } from '../lib/qualification';

const emptyContact: Contact = { name: '', role: '', email: '', phone: '', formUrl: '', profileUrl: '' };
const timestamp = '2026-10-03T10:00:00.000Z';
function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1', name: 'Atelier fictif', website: '', city: '', business: '',
    targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown',
    observation: '', proofUrl: '', observedOn: '', trigger: '', stage: 'À étudier',
    archived: false, oppositionActive: false, oppositionDate: '', oppositionNote: '',
    contact: { ...emptyContact }, nextAction: null, createdAt: timestamp, updatedAt: timestamp,
    ...overrides,
  };
}
function backup(): Backup {
  return {
    schemaVersion: 1, exportedAt: timestamp, companies: [company()],
    activities: [{ id: 'activity-1', companyId: 'company-1', kind: 'note', type: '',
      date: '2026-10-03', text: 'Une note de test.', createdAt: timestamp }],
    aiTests: [{ id: 'ai-1', companyId: 'company-1', panel: '', period: '', tool: '',
      interface: '', mode: 'unknown', model: '', questions: '', validResponses: 10,
      recommendations: 2, citations: 1, notes: '', proofUrl: '', createdAt: timestamp }],
    settings: { targetCity: 'Montpellier', targetBusiness: 'Rénovation intérieure' },
  };
}

test('a company can be created with its name alone and incomplete qualification', () => {
  assert.deepEqual(companyInputSchema.parse({ name: '  Atelier  ' }), {
    name: 'Atelier', website: '', city: '', business: '',
  });
  const parsed = companyDetailsSchema.parse({ name: 'Atelier' });
  assert.equal(parsed.targetFit, 'unknown');
  assert.equal(parsed.problemFound, 'unknown');
  assert.equal(parsed.contactAvailable, 'unknown');
  assert.equal(parsed.stage, 'À étudier');
  assert.deepEqual(parsed.contact, emptyContact);
  assert.equal(qualify(company(parsed)).label, 'À vérifier');
  for (const name of ['', '   ', 'x'.repeat(181)]) {
    assert.equal(companyInputSchema.safeParse({ name }).success, false);
  }
});

test('websites normalize bare domains while every stored link stays HTTP(S)', () => {
  assert.equal(companyInputSchema.parse({ name: 'Atelier', website: 'WWW.Example.fr/contact' }).website,
    'https://www.example.fr/contact');
  assert.equal(companyInputSchema.parse({ name: 'Atelier', website: 'http://example.fr' }).website,
    'http://example.fr/');
  for (const website of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///tmp/test',
    'ftp://example.fr', 'https://user:secret@example.fr', 'not a URL']) {
    assert.equal(companyInputSchema.safeParse({ name: 'Atelier', website }).success, false, website);
  }
  for (const field of ['proofUrl', 'contact.formUrl', 'contact.profileUrl']) {
    const input = field === 'proofUrl' ? { name: 'Atelier', proofUrl: 'javascript:alert(1)' }
      : { name: 'Atelier', contact: { [field.split('.')[1]]: 'javascript:alert(1)' } };
    assert.equal(companyDetailsSchema.safeParse(input).success, false, field);
  }
});

test('professional contact requires a valid channel; a name and role are not channels', () => {
  assert.equal(hasProfessionalContact(null), false);
  assert.equal(hasProfessionalContact({ name: 'Contact', role: 'Gérante' }), false);
  for (const contact of [
    { email: 'bonjour@example.fr' }, { phone: '+33 (0)6 12 34 56 78' },
    { formUrl: 'https://example.fr/contact' }, { profileUrl: 'https://linkedin.com/in/exemple' },
  ]) assert.equal(hasProfessionalContact(contact), true);
  for (const contact of [
    { email: 'invalide' }, { phone: '123' }, { phone: 'appelez-moi' },
    { phone: '1234567890123456' }, { formUrl: 'javascript:alert(1)' },
  ]) assert.equal(hasProfessionalContact(contact), false);
  assert.equal(companyDetailsSchema.safeParse({ name: 'Atelier', contact: { email: 'invalide' } }).success, false);
  assert.equal(companyDetailsSchema.safeParse({ name: 'Atelier', contact: { phone: '123' } }).success, false);
});

test('yes to a concrete problem requires its observation and yes to contact requires a channel', () => {
  const observationError = companyDetailsSchema.safeParse({ name: 'Atelier', problemFound: 'yes', observation: '  ' });
  assert.equal(observationError.success, false);
  if (!observationError.success) assert.equal(observationError.error.issues[0].path[0], 'observation');
  assert.equal(companyDetailsSchema.safeParse({ name: 'Atelier', contactAvailable: 'yes', contact: emptyContact }).success, false);
  assert.equal(companyDetailsSchema.safeParse({ name: 'Atelier', targetFit: 'yes', problemFound: 'yes',
    observation: 'Le formulaire de contact est cassé.', contactAvailable: 'yes',
    contact: { email: 'bonjour@example.fr' } }).success, true);
});

test('all 27 qualification answer combinations follow the documented priority', () => {
  const answers: Answer[] = ['yes', 'no', 'unknown'];
  for (const targetFit of answers) for (const problemFound of answers) for (const contactAvailable of answers) {
    const record = company({ targetFit, problemFound, contactAvailable,
      observation: 'Le lien de contact est cassé.', contact: { ...emptyContact, email: 'bonjour@example.fr' } });
    const expected = targetFit === 'no' ? 'Hors cible'
      : problemFound === 'no' ? 'Pas de besoin repéré'
        : targetFit === 'yes' && problemFound === 'yes' && contactAvailable === 'yes' ? 'Bonne piste'
          : targetFit === 'yes' && problemFound === 'yes' ? 'Contact à trouver' : 'À vérifier';
    assert.equal(qualify(record).label, expected, [targetFit, problemFound, contactAvailable].join('/'));
    assert.ok(qualify(record).explanation.length > 0);
    assert.equal(qualify({ ...record, oppositionActive: true }).label, 'Ne plus contacter');
  }
});

test('qualification recalculates when its observation, answers or last contact change', () => {
  const good = company({ targetFit: 'yes', problemFound: 'yes', contactAvailable: 'yes',
    observation: 'Le formulaire ne fonctionne pas.', contact: { ...emptyContact, email: 'bonjour@example.fr' } });
  assert.equal(qualify(good).label, 'Bonne piste');
  assert.equal(qualify({ ...good, observation: '' }).label, 'À vérifier');
  assert.equal(qualify({ ...good, contact: emptyContact }).label, 'À vérifier');
  assert.equal(qualify({ ...good, contactAvailable: 'unknown', contact: emptyContact }).label, 'Contact à trouver');
  assert.equal(qualify({ ...good, targetFit: 'no' }).label, 'Hors cible');
  assert.equal(qualify({ ...good, problemFound: 'no' }).label, 'Pas de besoin repéré');
});

test('date validation handles Gregorian leap years and never silently rolls impossible dates forward', () => {
  for (const value of ['', '2024-02-29', '2000-02-29', '2026-10-03', '0099-01-01']) {
    assert.equal(dateSchema.safeParse(value).success, true, value);
  }
  for (const value of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01',
    '2026-01-00', '0000-01-01', '2026-1-01', '03/10/2026', '2026-10-03T00:00:00Z']) {
    assert.equal(dateSchema.safeParse(value).success, false, value);
    assert.equal(isValidDate(value), false, value);
  }
  assert.equal(isValidDate(''), false);
  assert.equal(nextActionInputSchema.safeParse({ text: 'Appeler', date: '2026-02-30' }).success, false);
  assert.equal(nextActionInputSchema.safeParse({ text: ' ', date: '' }).success, false);
  assert.equal(activityInputSchema.safeParse({ text: 'Note', date: '2026-02-30' }).success, false);
});

test('Paris dates correctly cross midnight in winter and summer and follow daylight saving changes', () => {
  assert.equal(parisToday(new Date('2026-01-10T23:30:00Z')), '2026-01-11');
  assert.equal(parisToday(new Date('2026-07-10T22:30:00Z')), '2026-07-11');
  assert.equal(parisToday(new Date('2026-03-28T23:30:00Z')), '2026-03-29');
  assert.equal(parisToday(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
  assert.equal(parisToday(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
  assert.equal(parisToday(new Date('2026-10-25T22:30:00Z')), '2026-10-25');
});

test('action due states distinguish missing, overdue, today and future without an hour', () => {
  assert.equal(dueStatus('', '2026-10-03'), 'unplanned');
  assert.equal(dueStatus('invalid', '2026-10-03'), 'unplanned');
  assert.equal(dueStatus('2026-10-02', '2026-10-03'), 'late');
  assert.equal(dueStatus('2026-10-03', '2026-10-03'), 'today');
  assert.equal(dueStatus('2026-10-04', '2026-10-03'), 'upcoming');
  assert.equal(dueStatus('2027-01-01', '2026-12-31'), 'upcoming');
  assert.equal(formatDate(''), 'À planifier');
  assert.equal(formatDate('2026-02-30'), 'Date invalide');
  assert.match(formatDate('2026-10-03'), /^3 oct\. 2026$/);
});

test('closed, archived and opposed companies are excluded from all contact suggestions', () => {
  assert.equal(isEligible(company()), true);
  for (const override of [{ stage: 'Gagné' as const }, { stage: 'Perdu' as const },
    { archived: true }, { oppositionActive: true }]) assert.equal(isEligible(company(override)), false);
  assert.equal(isEligible(company({ stage: 'En échange' })), true);
});

test('duplicate normalization ignores accents/case/spacing and website scheme/path/www', () => {
  assert.equal(normalizeText('  RÉNO   Atelier  '), 'reno atelier');
  assert.equal(normalizedDomain('HTTPS://WWW.Example.FR/contact?q=x'), 'example.fr');
  assert.equal(normalizedDomain('example.fr/une-page'), 'example.fr');
  assert.equal(normalizedDomain('http://example.fr:8080'), 'example.fr');
  assert.equal(normalizedDomain('https://example.fr.'), 'example.fr');
  assert.equal(normalizedDomain('javascript:alert(1)'), '');
  assert.equal(normalizedDomain(''), '');
});

test('AI tests can remain incomplete without inventing numbers or merging measures', () => {
  const incomplete = aiTestInputSchema.parse({ notes: 'Interface à préciser.' });
  assert.equal(incomplete.mode, 'unknown');
  assert.equal(incomplete.validResponses, null);
  assert.equal(incomplete.recommendations, null);
  assert.equal(incomplete.citations, null);
  assert.deepEqual(aiResults(incomplete), { recommendations: 'Non renseigné', citations: 'Non renseigné' });
  assert.deepEqual(aiResults({ validResponses: null, recommendations: 2, citations: 1 }), {
    recommendations: 'Non renseigné', citations: 'Non renseigné',
  });
  const measured = aiTestInputSchema.parse({ validResponses: 10, recommendations: 2, citations: 1 });
  assert.deepEqual(aiResults(measured), {
    recommendations: 'Recommandée dans 2 réponses sur 10', citations: 'Site cité dans 1 réponse sur 10',
  });
  assert.deepEqual(aiResults({ validResponses: 10, recommendations: 0, citations: null }), {
    recommendations: 'Recommandée dans 0 réponses sur 10', citations: 'Non renseigné',
  });
  assert.deepEqual(aiResults({ validResponses: 0, recommendations: 0, citations: 0 }), {
    recommendations: 'Non mesuré', citations: 'Non mesuré',
  });
  assert.deepEqual(aiResults({ validResponses: 0, recommendations: null, citations: null }), {
    recommendations: 'Non mesuré', citations: 'Non mesuré',
  });
  assert.deepEqual(aiResults({ validResponses: 10, recommendations: null, citations: 2 }), {
    recommendations: 'Non renseigné', citations: 'Site cité dans 2 réponses sur 10',
  });
});

test('AI count validation rejects negatives, fractions and measurements exceeding valid responses', () => {
  for (const count of [-1, 0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '2']) {
    for (const field of ['validResponses', 'recommendations', 'citations']) {
      assert.equal(aiTestInputSchema.safeParse({ [field]: count }).success, false, `${field}: ${String(count)}`);
    }
  }
  assert.equal(aiTestInputSchema.safeParse({ validResponses: 10, recommendations: 12 }).success, false);
  assert.equal(aiTestInputSchema.safeParse({ validResponses: 10, citations: 12 }).success, false);
  assert.equal(aiTestInputSchema.safeParse({ validResponses: 0, recommendations: 1 }).success, false);
  assert.equal(aiTestInputSchema.safeParse({ validResponses: 10, recommendations: 10, citations: 10 }).success, true);
  assert.equal(aiTestInputSchema.safeParse({ validResponses: null, recommendations: 2 }).success, true);
  assert.equal(aiTestInputSchema.safeParse({ proofUrl: 'file:///tmp/proof' }).success, false);
  assert.equal(aiResults({ validResponses: 10, recommendations: 12, citations: 1 }).recommendations, 'Non renseigné');
});

test('complete backups preserve every entity, settings, action and opposition', () => {
  const data = backup();
  data.companies[0].nextAction = { id: 'action-1', text: 'Appeler', date: '', createdAt: timestamp };
  const normalized=()=>({...data,schemaVersion:2,settings:{...data.settings,targetCompanyType:'',targetOffer:'',targetExclusions:''},companies:data.companies.map(c=>({...c,qualification:emptyQualification()}))});
  assert.deepEqual(backupSchema.parse(data), normalized());
  data.companies[0].nextAction = null;
  data.companies[0].oppositionActive = true;
  data.companies[0].oppositionDate = '2026-10-03';
  data.companies[0].oppositionNote = 'Ne souhaite plus être contacté.';
  assert.deepEqual(backupSchema.parse(data), normalized());
});

test('backup validation rejects missing properties, unsafe URLs, bad dates, counts and schema versions', () => {
  const mutations: ((data: any) => void)[] = [
    data => { data.schemaVersion = 99; },
    data => { data.companies[0].id = '../settings'; },
    data => { delete data.companies[0].contact; },
    data => { delete data.companies[0].website; },
    data => { delete data.companies[0].contact.email; },
    data => { delete data.aiTests[0].recommendations; },
    data => { data.exportedAt = '2026-10-03'; },
    data => { data.companies[0].createdAt = '2026-02-30T10:00:00Z'; },
    data => { data.companies[0].website = 'javascript:alert(1)'; },
    data => { data.companies[0].contact.formUrl = 'ftp://example.fr'; },
    data => { data.companies[0].observedOn = '2026-02-30'; },
    data => { data.companies[0].contactAvailable = 'yes'; },
    data => { data.companies[0].problemFound = 'yes'; },
    data => { data.aiTests[0].recommendations = 12; },
    data => { data.aiTests[0].citations = -1; },
    data => { data.aiTests[0].mode = 'invented'; },
    data => { data.extra = 'unknown data'; },
  ];
  mutations.forEach((mutate, index) => {
    const data = backup(); mutate(data);
    assert.equal(backupSchema.safeParse(data).success, false, `invalid mutation ${index}`);
  });
});

test('backup validation enforces global identifier uniqueness and company relationships', () => {
  for (const mutate of [
    (data: Backup) => { data.companies.push({ ...data.companies[0] }); },
    (data: Backup) => { data.activities[0].id = data.companies[0].id; },
    (data: Backup) => { data.aiTests[0].id = data.activities[0].id; },
    (data: Backup) => { data.activities[0].companyId = 'missing'; },
    (data: Backup) => { data.aiTests[0].companyId = 'missing'; },
    (data: Backup) => { data.companies[0].nextAction = { id: 'ai-1', text: 'Appeler', date: '', createdAt: timestamp }; },
  ]) {
    const data = backup(); mutate(data);
    assert.equal(backupSchema.safeParse(data).success, false);
  }
});

test('a backup cannot create an active relance for an opposed company', () => {
  const data = backup();
  data.companies[0].oppositionActive = true;
  assert.equal(backupSchema.safeParse(data).success, false, 'An active opposition needs a date');
  data.companies[0].oppositionDate = '2026-10-03';
  data.companies[0].nextAction = { id: 'action-1', text: 'Appeler', date: '2026-10-04', createdAt: timestamp };
  assert.equal(backupSchema.safeParse(data).success, false);
});

test('validation errors stay in French for fields, enums, timestamps and malformed backups', () => {
  const invalidName = companyInputSchema.safeParse({ name: null });
  assert.equal(invalidName.success, false);
  if (!invalidName.success) assert.match(invalidName.error.issues[0].message, /^Entrée invalide/);
  const invalidAnswer = companyDetailsSchema.safeParse({ name: 'Atelier', targetFit: 'maybe' });
  assert.equal(invalidAnswer.success, false);
  if (!invalidAnswer.success) assert.equal(invalidAnswer.error.issues[0].message, 'Choisissez Oui, Non ou À vérifier.');
  const invalidMode = aiTestInputSchema.safeParse({ mode: 'desktop' });
  assert.equal(invalidMode.success, false);
  if (!invalidMode.success) assert.match(invalidMode.error.issues[0].message, /^Choisissez Recherche web/);
  const invalidBackup = backup();
  invalidBackup.exportedAt = 'not a timestamp';
  const parsed = backupSchema.safeParse(invalidBackup);
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.equal(parsed.error.issues[0].message, 'date et heure ISO invalide');
  const missingProperty = backup();
  Reflect.deleteProperty(missingProperty.companies[0], 'contact');
  const missing = backupSchema.safeParse(missingProperty);
  assert.equal(missing.success, false);
  if (!missing.success) assert.match(missing.error.issues[0].message, /^Entrée invalide/);
});
