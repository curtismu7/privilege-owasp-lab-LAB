// {{cast}} templating for the story data and the vertical flavour of the Mock output.
// customer.config.json (optional, git-ignored) overrides the display strings of the chosen vertical.
// String tokens: {{castOrg}}, {{castAdmin}}, {{castEnvName}}, {{castHost}}. A test fails on any token a vertical does not define.
// Each vertical also carries a `seed` (users, apps, groups, populations) that only the Mock output reads; every name is made up.
import fs from 'node:fs';
import { scanHosts } from './safety.js';

const TOKEN = /\{\{(\w+)\}\}/g;
const MAX_CAST = 40;
const HOST = /^[a-z0-9-]{1,40}$/;

export const VERTICALS = {
  banking: {
    castOrg: 'Fabrikam Bank', castAdmin: 'Dana Okafor', castEnvName: 'Fabrikam Digital Banking', castHost: 'fabrikam',
    seed: {
      users: [['Ava', 'Lindqvist'], ['Marcus', 'Chen'], ['Priya', 'Raman'], ['Tomas', 'Novak'], ['Grace', 'Adeyemi']],
      apps: [['Online Banking Portal', 'WEB_APP'], ['Mobile Banking App', 'NATIVE_APP'], ['Loan Desk SPA', 'SINGLE_PAGE_APP'], ['Provisioning Worker', 'WORKER']],
      groups: [['Branch Tellers', 'Front-line staff at the branches'], ['Wealth Advisors', 'Advisors with read access to portfolios'], ['Fraud Analysts', 'Review flagged transfers']],
      populations: [['Retail Customers', 'Personal banking customers'], ['Employees', 'Staff identities']],
    },
  },
  healthcare: {
    castOrg: 'Contoso Health', castAdmin: 'Sam Whitfield', castEnvName: 'Contoso Patient Access', castHost: 'contoso',
    seed: {
      users: [['Noah', 'Barrett'], ['Elena', 'Petrova'], ['Kwame', 'Mensah'], ['Lucia', 'Ortega'], ['Hiro', 'Tanaka']],
      apps: [['Patient Portal', 'WEB_APP'], ['Care Team Mobile', 'NATIVE_APP'], ['Scheduling SPA', 'SINGLE_PAGE_APP'], ['Records Sync Worker', 'WORKER']],
      groups: [['Nurses', 'Ward nursing staff'], ['Physicians', 'Attending physicians'], ['Front Desk', 'Reception and scheduling']],
      populations: [['Patients', 'Patient portal accounts'], ['Clinical Staff', 'Staff identities']],
    },
  },
  retail: {
    castOrg: 'Northwind Retail', castAdmin: 'Jordan Ellis', castEnvName: 'Northwind Storefront', castHost: 'northwind',
    seed: {
      users: [['Mia', 'Fischer'], ['Leo', 'Haddad'], ['Zoe', 'Kowalski'], ['Ethan', 'Brooks'], ['Nadia', 'Sato']],
      apps: [['Storefront Web', 'WEB_APP'], ['Shopper Mobile App', 'NATIVE_APP'], ['Store Associate SPA', 'SINGLE_PAGE_APP'], ['Catalog Sync Worker', 'WORKER']],
      groups: [['Store Managers', 'Managers of the physical stores'], ['Loyalty Members', 'Shoppers in the loyalty program'], ['Support Agents', 'Customer support desk']],
      populations: [['Shoppers', 'Customer accounts'], ['Associates', 'Staff identities']],
    },
  },
};
export const DEFAULT_VERTICAL = 'retail';
export const DEFAULT_CAST = VERTICALS[DEFAULT_VERTICAL];
export const CAST_TOKENS = ['castOrg', 'castAdmin', 'castEnvName', 'castHost'];

export const unfilled = (text, cast) => [...String(text).matchAll(TOKEN)].map((m) => m[1]).filter((k) => !CAST_TOKENS.includes(k) || typeof cast[k] !== 'string');
export const fill = (text, cast) => String(text).replace(TOKEN, (m, k) => (CAST_TOKENS.includes(k) && typeof cast[k] === 'string' ? cast[k] : m));
export function fillDeep(value, cast) {
  if (typeof value === 'string') return fill(value, cast);
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, cast));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, cast)]));
  return value;
}

export const verticalFrom = (id) => (typeof id === 'string' && Object.hasOwn(VERTICALS, id) ? id : DEFAULT_VERTICAL);

// Only org, admin, envName and host, as short plain strings; anything else in the file is ignored.
export function loadCast(file, vertical = DEFAULT_VERTICAL) {
  const id = verticalFrom(vertical);
  const cast = { ...VERTICALS[id], vertical: id };
  if (!file) return cast;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [short, key] of [['org', 'castOrg'], ['admin', 'castAdmin'], ['envName', 'castEnvName'], ['host', 'castHost']]) {
      const v = cfg?.cast?.[short];
      if (typeof v !== 'string' || !v.trim()) continue;
      const clean = v.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, MAX_CAST);
      if (/:\/\/|@/.test(clean) || scanHosts(clean).length) continue;
      if (short === 'host' && !HOST.test(clean.toLowerCase())) continue;
      cast[key] = short === 'host' ? clean.toLowerCase() : clean;
    }
  } catch { /* no file or not JSON: the defaults */ }
  return cast;
}
