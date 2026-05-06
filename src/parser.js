const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', 'target', 'coverage', '.idea'];

function findYaml(rootDir = process.cwd()) {
  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.shift();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) queue.push(path.join(dir, entry.name));
      } else if (/^application\.(ya?ml)$/.test(entry.name)) {
        return path.join(dir, entry.name);
      }
    }
  }
  return null;
}

function flattenKeys(obj, prefix = '', result = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenKeys(v, key, result);
    else result[key] = v;
  }
  return result;
}

// Resuelve ${VAR:default} → default
function resolveSpring(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{[^}]*?:([^}]+)\}/g, '$1').replace(/\$\{[^}]+\}/g, '');
}

// Descarta URLs, ARNs, rutas — solo acepta nombres simples
function isResourceName(v) {
  if (!v || typeof v !== 'string') return false;
  const t = v.trim();
  return t.length > 0
    && !/^https?:\/\//i.test(t)
    && !/^arn:/i.test(t)
    && !/[/\\]/.test(t)
    && !/^\d+\.\d+/.test(t);
}

function extractNames(flat, keyPattern) {
  return Object.entries(flat)
    .filter(([k]) => keyPattern.test(k))
    .map(([, v]) => resolveSpring(v))
    .filter(isResourceName);
}

function scanDynamoSchema(rootDir) {
  const schema = { gsis: [] };
  const queue = [rootDir];

  while (queue.length) {
    const dir = queue.shift();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) queue.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.java')) continue;

      const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      if (!/@DynamoDbBean/.test(content)) continue;

      for (const [, annotations, , fieldName] of content.matchAll(/((?:@\w+[^)]*\)\s*)*)(public\s+\w+\s+get(\w+)\(\))/g)) {
        const attr = fieldName.charAt(0).toLowerCase() + fieldName.slice(1);
        if (/@DynamoDbPartitionKey\b/.test(annotations) && !/@DynamoDbSecondary/.test(annotations)) {
          schema.pk = attr;
        } else if (/@DynamoDbSortKey\b/.test(annotations) && !/@DynamoDbSecondary/.test(annotations)) {
          schema.sk = attr;
        } else if (/@DynamoDbSecondaryPartitionKey/.test(annotations)) {
          const m = annotations.match(/indexNames\s*=\s*["']([^"']+)["']/);
          if (m) {
            let gsi = schema.gsis.find(g => g.name === m[1]) || { name: m[1] };
            if (!schema.gsis.find(g => g.name === m[1])) schema.gsis.push(gsi);
            gsi.pk = attr;
          }
        } else if (/@DynamoDbSecondarySortKey/.test(annotations)) {
          const m = annotations.match(/indexNames\s*=\s*["']([^"']+)["']/);
          if (m) {
            let gsi = schema.gsis.find(g => g.name === m[1]) || { name: m[1] };
            if (!schema.gsis.find(g => g.name === m[1])) schema.gsis.push(gsi);
            gsi.sk = attr;
          }
        }
      }
      if (schema.pk) break;
    }
    if (schema.pk) break;
  }
  return schema.pk ? schema : null;
}

function parse(rootDir = process.cwd()) {
  const yamlPath = findYaml(rootDir);
  if (!yamlPath) return { resources: {}, yamlPath: null };

  const raw = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || {};
  const flat = flattenKeys(raw);
  const resources = {};

  const tables  = extractNames(flat, /table-name|tablename/i);
  const queues  = extractNames(flat, /queue-name|queuename|queue-url/i);
  const buckets = extractNames(flat, /bucket-name|bucketname/i);
  const topics  = extractNames(flat, /topic-name|topicname|topic-arn/i);
  const roles   = extractNames(flat, /role-name|rolename/i);

  if (tables.length) {
    const schema = scanDynamoSchema(rootDir);
    resources.dynamodb = { tables, ...(schema ? { schema } : {}) };
  }
  if (queues.length)  resources.sqs = { queues };
  if (buckets.length) resources.s3  = { buckets };
  if (topics.length)  resources.sns = { topics };
  if (roles.length)   resources.iam = { roles };

  return { resources, yamlPath };
}

module.exports = { parse };
