const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');
const { SQSClient, CreateQueueCommand, GetQueueUrlCommand } = require('@aws-sdk/client-sqs');
const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { SNSClient, CreateTopicCommand } = require('@aws-sdk/client-sns');
const { IAMClient, CreateRoleCommand, GetRoleCommand } = require('@aws-sdk/client-iam');

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1';

const clientConfig = {
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};

const clients = {
  dynamodb: new DynamoDBClient(clientConfig),
  sqs:      new SQSClient(clientConfig),
  s3:       new S3Client({ ...clientConfig, forcePathStyle: true }),
  sns:      new SNSClient(clientConfig),
  iam:      new IAMClient(clientConfig),
};

async function exists(check) {
  try { await check(); return true; } catch { return false; }
}

async function createTable(name, schema = {}) {
  const already = await exists(() =>
    clients.dynamodb.send(new ListTablesCommand({})).then(r => {
      if (!r.TableNames.includes(name)) throw new Error();
    })
  );
  if (already) return console.error(`  [DynamoDB] tabla "${name}" ya existe`);

  const { pk = 'id', sk, gsis = [] } = schema;

  const attrSet = new Map([[pk, 'S']]);
  if (sk) attrSet.set(sk, 'S');
  gsis.forEach(g => { attrSet.set(g.pk, 'S'); if (g.sk) attrSet.set(g.sk, 'S'); });

  const keySchema = [{ AttributeName: pk, KeyType: 'HASH' }];
  if (sk) keySchema.push({ AttributeName: sk, KeyType: 'RANGE' });

  const globalSecondaryIndexes = gsis.map(g => ({
    IndexName: g.name,
    KeySchema: [
      { AttributeName: g.pk, KeyType: 'HASH' },
      ...(g.sk ? [{ AttributeName: g.sk, KeyType: 'RANGE' }] : []),
    ],
    Projection: { ProjectionType: 'ALL' },
  }));

  await clients.dynamodb.send(new CreateTableCommand({
    TableName: name,
    AttributeDefinitions: [...attrSet.entries()].map(([n, t]) => ({ AttributeName: n, AttributeType: t })),
    KeySchema: keySchema,
    BillingMode: 'PAY_PER_REQUEST',
    ...(globalSecondaryIndexes.length ? { GlobalSecondaryIndexes: globalSecondaryIndexes } : {}),
  }));
  console.error(`  [DynamoDB] tabla "${name}" creada (PK:${pk}${sk ? ` SK:${sk}` : ''}${gsis.length ? ` GSIs:${gsis.map(g=>g.name).join(',')}` : ''})`);
}

async function createQueue(name) {
  const already = await exists(() =>
    clients.sqs.send(new GetQueueUrlCommand({ QueueName: name }))
  );
  if (already) return console.error(`  [SQS] cola "${name}" ya existe`);

  await clients.sqs.send(new CreateQueueCommand({ QueueName: name }));
  console.error(`  [SQS] cola "${name}" creada`);
}

async function createBucket(name) {
  const already = await exists(() =>
    clients.s3.send(new HeadBucketCommand({ Bucket: name }))
  );
  if (already) return console.error(`  [S3] bucket "${name}" ya existe`);

  await clients.s3.send(new CreateBucketCommand({ Bucket: name }));
  console.error(`  [S3] bucket "${name}" creado`);
}

async function createTopic(name) {
  // SNS CreateTopic es idempotente
  const res = await clients.sns.send(new CreateTopicCommand({ Name: name }));
  console.error(`  [SNS] topic "${name}" listo: ${res.TopicArn}`);
}

async function createRole(name) {
  const already = await exists(() =>
    clients.iam.send(new GetRoleCommand({ RoleName: name }))
  );
  if (already) return console.error(`  [IAM] rol "${name}" ya existe`);

  await clients.iam.send(new CreateRoleCommand({
    RoleName: name,
    AssumeRolePolicyDocument: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    }),
  }));
  console.error(`  [IAM] rol "${name}" creado`);
}

async function provision(services, resources) {
  for (const service of services) {
    const cfg = resources[service] || {};

    if (service === 'dynamodb') {
      const tables = cfg.tables?.length ? cfg.tables : ['default-table'];
      const schemasByTable = cfg.schemasByTable || new Map();
      for (const t of tables) await createTable(t, schemasByTable.get(t) || {});
    }
    if (service === 'sqs') {
      const queues = cfg.queues?.length ? cfg.queues : ['default-queue'];
      for (const q of queues) await createQueue(q);
    }
    if (service === 's3') {
      const buckets = cfg.buckets?.length ? cfg.buckets : ['default-bucket'];
      for (const b of buckets) await createBucket(b);
    }
    if (service === 'sns') {
      const topics = cfg.topics?.length ? cfg.topics : ['default-topic'];
      for (const t of topics) await createTopic(t);
    }
    if (service === 'iam') {
      const roles = cfg.roles?.length ? cfg.roles : ['default-role'];
      for (const r of roles) await createRole(r);
    }
  }
}

module.exports = { provision };
