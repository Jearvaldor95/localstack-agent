const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Patrones que indican uso de cada servicio AWS
const PATTERNS = {
  dynamodb: [/software\.amazon\.awssdk.*dynamo/i, /com\.amazonaws.*dynamodb/i, /DynamoDb/i, /@aws-sdk\/client-dynamodb/i],
  sqs:      [/software\.amazon\.awssdk.*sqs/i, /com\.amazonaws.*sqs/i, /SqsClient/i, /SQSClient/i, /@aws-sdk\/client-sqs/i],
  s3:       [/software\.amazon\.awssdk.*s3/i, /com\.amazonaws.*s3/i, /S3Client/i, /@aws-sdk\/client-s3/i],
  sns:      [/software\.amazon\.awssdk.*sns/i, /com\.amazonaws.*sns/i, /SnsClient/i, /SNSClient/i, /@aws-sdk\/client-sns/i],
  iam:      [/software\.amazon\.awssdk.*iam/i, /com\.amazonaws.*iam/i, /IamClient/i, /IAMClient/i, /@aws-sdk\/client-iam/i],
};

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage'];
const CODE_EXTS = ['.js', '.ts', '.java', '.py', '.go', '.cs', '.rb'];

function getGitFiles() {
  try {
    const output = execSync('git diff --name-only HEAD', { encoding: 'utf8' });
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' });
    const all = [...new Set([...output.split('\n'), ...staged.split('\n'), ...untracked.split('\n')])]
      .filter(f => f && CODE_EXTS.includes(path.extname(f)));
    return all.length > 0 ? all : null;
  } catch {
    return null;
  }
}

function walkDir(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, files);
    else if (CODE_EXTS.includes(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function detect(rootDir = process.cwd()) {
  const gitFiles = getGitFiles();
  const files = gitFiles
    ? gitFiles.map(f => path.resolve(rootDir, f)).filter(fs.existsSync)
    : walkDir(rootDir);

  const found = new Set();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const [service, patterns] of Object.entries(PATTERNS)) {
      if (patterns.some(p => p.test(content))) {
        found.add(service);
      }
    }
  }

  return [...found];
}

module.exports = { detect };
