import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
const ROOT_DIR = path.resolve('.');
import fs from 'fs';
import { query } from './db.ts';

const app = express();
const PORT = 3001;

app.use(cors({
  origin: ['https://docmind-ai-gray.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});



const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/v1/documents', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: { code: 'NO_FILE', message: 'No file uploaded.' } });
    return;
  }

  const documentId = 'doc-' + Date.now();

  // Save to database
  await query(
    `INSERT INTO documents (id, filename, filepath, status, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [documentId, req.file.originalname, req.file.path, 'pending', 'Document is queued for processing']
  );

  console.log(`Saved to DB: ${req.file.originalname} → ${documentId}`);

  // Respond immediately to frontend
  res.status(202).json({
    documentId,
    filename: req.file.originalname,
    status: 'pending',
    statusUrl: `/api/v1/documents/${documentId}/status`,
  });

  // Process in background
  processDocument(documentId, req.file.path, req.file.originalname);
});

async function processDocument(documentId: string, filePath: string, filename: string) {
  try {
    // Update status to processing
    await query(
      `UPDATE documents SET status = $1, message = $2, updated_at = NOW() WHERE id = $3`,
      ['processing', 'Analyzing document with AI...', documentId]
    );

    console.log(`Processing started: ${documentId}`);

    // Call Python processing service
console.log('Sending file path:', path.join(ROOT_DIR, filePath));
    const response = await fetch('http://localhost:8000/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: documentId,
        file_path: path.join(ROOT_DIR, filePath),
        filename: filename,
      }),
    });

    if (!response.ok) {
      throw new Error(`Processing service returned ${response.status}`);
    }

    const result = await response.json();

    // Save extraction result and mark complete
    await query(
      `UPDATE documents SET status = $1, message = $2, extraction_result = $3, updated_at = NOW() WHERE id = $4`,
      ['complete', 'Analysis complete', JSON.stringify(result), documentId]
    );

    console.log(`Processing complete: ${documentId}`);

  } catch (err) {
    console.error(`Processing failed for ${documentId}:`, err);
    await query(
      `UPDATE documents SET status = $1, message = $2, updated_at = NOW() WHERE id = $3`,
      ['failed', 'Processing failed. Please try again.', documentId]
    );
  }
}

app.get('/api/v1/documents/:id/status', async (req, res) => {
  const { id } = req.params;

  const result = await query(
    'SELECT status, message FROM documents WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }

  res.json({
    documentId: id,
    status: result.rows[0].status,
    message: result.rows[0].message,
  });
});

// Findings endpoint
app.get('/api/v1/documents/:id/findings', async (req, res) => {
  const { id } = req.params;

  const result = await query(
    'SELECT extraction_result FROM documents WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }

  const extraction = result.rows[0].extraction_result;
  res.json({ findings: extraction?.findings || [] });
});

// Summary endpoint
app.get('/api/v1/documents/:id/summary', async (req, res) => {
  const { id } = req.params;

  const result = await query(
    'SELECT filename, extraction_result FROM documents WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }

  const extraction = result.rows[0].extraction_result;
  const level = req.query.level || 'technical';

  try {
    const message = await fetch('http://localhost:8000/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: id,
        extraction_result: extraction,
        level: level,
      }),
    });

    if (!message.ok) throw new Error('Summary service failed');
    const summary = await message.json();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: { code: 'SUMMARY_FAILED', message: 'Could not generate summary.' } });
  }
});

// Diagram endpoint
app.get('/api/v1/documents/:id/diagram', async (req, res) => {
  const { id } = req.params;

  const result = await query(
    'SELECT extraction_result FROM documents WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }

  const extraction = result.rows[0].extraction_result;
  const workflows = extraction?.workflows || [];
  const dependencies = extraction?.dependencies || [];

  // Build Mermaid flowchart
  let mermaid = 'flowchart TD\n';
  workflows.forEach((step: any) => {
    const nodeId = `W${step.index}`;
    const label = step.description.substring(0, 40).replace(/"/g, "'");
    mermaid += `  ${nodeId}["${label}"]\n`;
  });

  // Connect sequential workflow steps
  for (let i = 0; i < workflows.length - 1; i++) {
    mermaid += `  W${i} --> W${i + 1}\n`;
  }

  res.json({
    mermaidSource: mermaid,
    nodeCount: workflows.length,
    diagramType: 'flowchart',
  });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 20MB limit.' } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Unknown error' } });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});