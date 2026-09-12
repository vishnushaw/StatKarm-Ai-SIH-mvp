const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('crypto');

const root = __dirname;
const dataFile = path.join(root, 'data.json');
const uploadedFilesDir = path.join(root, 'uploaded-pdfs');
const pdfExtractorScript = path.join(root, 'backend', 'extract_pdf_text.py');
const pdfPython = path.join(root, 'backend', '.venv', 'Scripts', 'python.exe');
const pdftoppm = path.join(root, '..', '..', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'poppler', 'Library', 'bin', 'pdftoppm.exe');
const privateEnvFile = path.join(root, 'backend', '.env');
const privateEnv = fs.existsSync(privateEnvFile)
  ? Object.fromEntries(fs.readFileSync(privateEnvFile, 'utf8').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    .map(line => { const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)]; }))
  : {};
const groqApiKey = process.env.GROQ_API_KEY || privateEnv.GROQ_API_KEY || '';
const groqModel = process.env.GROQ_MODEL || privateEnv.GROQ_MODEL || 'openai/gpt-oss-20b';
const groqVisionModel = process.env.GROQ_VISION_MODEL || privateEnv.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const readDb = () => {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (err) {
    console.error('Error reading data.json, returning default fallback', err);
    return { user: {}, skills: [], courses: [], events: [], assessment: { questions: [] }, analytics: {}, documents: [], quizHistory: [] };
  }
};

const writeDb = db => {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing data.json', err);
  }
};

const publicUser = user => ({
  id: user.id,
  name: user.name,
  username: user.username || user.name,
  initials: user.initials,
  email: user.email,
  role: user.role,
  organization: user.organization
});

const passwordHash = password => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

const passwordMatches = (password, stored) => {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
};

const setCors = res => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
};

const send = (res, status, body) => {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Read request bodies as bytes so multipart PDF uploads are not corrupted by a
// string conversion. JSON requests continue to use the same helper.
const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) {
      reject(new Error('Upload exceeds the 15 MB limit.'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const parseBody = async req => {
  const body = await readBody(req);
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); } catch { return { raw: body.toString('utf8') }; }
};

const parseMultipart = (body, contentType = '') => {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields = {};
  let file = null;
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(boundary, cursor);
    if (start === -1) break;
    const headerStart = start + boundary.length + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.slice(headerStart, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd + 4);
    if (next === -1) break;
    const value = body.slice(headerEnd + 4, next - 2);
    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const filename = headers.match(/filename="([^"]*)"/i)?.[1];
    if (name && filename !== undefined) {
      file = { field: name, filename: path.basename(filename), buffer: value, contentType: headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || '' };
    } else if (name) {
      fields[name] = value.toString('utf8');
    }
    cursor = next;
  }
  return { fields, file };
};

const cleanPdfText = value => value
  .replace(/\\([nrt])/g, ' ')
  .replace(/\\[()\\]/g, m => m[1])
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const extractPdfTextWithPyPdf = pdfPath => {
  if (!fs.existsSync(pdfPython) || !fs.existsSync(pdfExtractorScript)) return '';
  const result = spawnSync(pdfPython, [pdfExtractorScript, pdfPath], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15000
  });
  if (result.status !== 0) {
    console.warn('pypdf extraction failed:', result.stderr?.trim());
    return '';
  }
  return cleanPdfText(result.stdout || '').slice(0, 200000);
};

const extractPdfTextWithGroqVision = async pdfPath => {
  if (!groqApiKey || !fs.existsSync(pdftoppm)) return '';
  const renderDir = path.join(uploadedFilesDir, `.ocr-${randomUUID()}`);
  try {
    fs.mkdirSync(renderDir, { recursive: true });
    // Render the first 20 pages at a resolution that remains below Groq's
    // base64 image-size limit while preserving readable document text.
    const render = spawnSync(pdftoppm, ['-jpeg', '-r', '150', '-scale-to', '1600', '-f', '1', '-l', '20', pdfPath, path.join(renderDir, 'page')], {
      encoding: 'utf8', timeout: 30000
    });
    if (render.status !== 0) {
      console.warn('PDF render for OCR failed:', render.stderr?.trim());
      return '';
    }
    const pages = fs.readdirSync(renderDir).filter(name => /^page-\d+\.jpg$/i.test(name)).sort();
    const batches = [];
    for (let index = 0; index < pages.length; index += 5) batches.push(pages.slice(index, index + 5));
    const text = [];
    for (const batch of batches) {
      const content = [
        { type: 'text', text: 'Perform OCR on these scanned document pages. Return only the readable text, preserving headings, lists, definitions, procedures, and numbers. Do not add commentary or infer missing content.' },
        ...batch.map(name => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(path.join(renderDir, name)).toString('base64')}` } }))
      ];
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
        body: JSON.stringify({ model: groqVisionModel, temperature: 0, max_tokens: 6000, messages: [{ role: 'user', content }] })
      });
      if (!response.ok) throw new Error(`Groq Vision OCR failed (${response.status}).`);
      const payload = await response.json();
      text.push(payload.choices?.[0]?.message?.content || '');
    }
    return cleanPdfText(text.join('\n')).slice(0, 200000);
  } catch (error) {
    console.warn('Groq Vision OCR failed:', error.message);
    return '';
  } finally {
    if (fs.existsSync(renderDir)) fs.rmSync(renderDir, { recursive: true, force: true });
  }
};

const extractPdfText = buffer => {
  // This lightweight local extractor handles both plain PDF text and common
  // Flate-compressed streams without depending on an external service.
  const zlib = require('zlib');
  const parts = [buffer.toString('latin1')];
  let searchAt = 0;
  while (true) {
    const streamAt = buffer.indexOf(Buffer.from('stream'), searchAt);
    if (streamAt === -1) break;
    const endAt = buffer.indexOf(Buffer.from('endstream'), streamAt);
    if (endAt === -1) break;
    const dictionary = buffer.slice(Math.max(0, streamAt - 1024), streamAt).toString('latin1');
    if (/FlateDecode/.test(dictionary)) {
      let dataStart = streamAt + 6;
      if (buffer[dataStart] === 13 && buffer[dataStart + 1] === 10) dataStart += 2;
      else if (buffer[dataStart] === 10) dataStart += 1;
      try { parts.push(zlib.inflateSync(buffer.slice(dataStart, endAt)).toString('latin1')); } catch { /* malformed/non-text stream */ }
    }
    searchAt = endAt + 9;
  }
  const literals = parts.join('\n').match(/\((?:\\.|[^\\)]){3,}\)/g) || [];
  return cleanPdfText(literals.map(value => value.slice(1, -1)).join(' ')).slice(0, 200000);
};

const deriveTopics = (text, filename) => {
  const source = `${filename} ${text}`.toLowerCase();

  const known = [
    'stratified sampling',
    'sampling',
    'survey design',
    'weighting',

    'data quality',
    'data cleaning',
    'data validation',
    'data preprocessing',

    'data visualization',
    'data visualisation',
    'charts',
    'graphs',
    'dashboard',
    'data storytelling',

    'metadata',
    'confidentiality',
    'privacy',
    'data protection',

    'cyber security',
    'cybersecurity',
    'information security',
    'security awareness',
    'phishing',
    'malware',
    'access control',
    'authentication',
    'incident response',

    'official statistics',
    'governance',
    'census',
    'ethics'
  ];

  const matched = known.filter(topic => source.includes(topic));

  return matched.length
    ? [...new Set(matched)].slice(0, 5)
    : [
        path.basename(filename, path.extname(filename))
          .replace(/[_-]+/g, ' ')
          .trim() || 'Official Statistics'
      ];
};

const getRecommendations = (db, competency = '', topic = '') => {
  const allCourses = (db.courses || []).map(c => ({
    id: c.id,
    title: c.title || '',
    provider: c.provider || 'iGOT Karmayogi',
    instructor: c.instructor || 'Senior Statistical Officer',
    duration_hours: c.duration_hours || Number((c.minutes / 60).toFixed(1)),
    minutes: c.minutes || 60,
    progress: c.progress || 0,
    direct_link: c.direct_link || 'https://portal.igotkarmayogi.gov.in/page/home',
    skills: Array.isArray(c.skills) ? c.skills : [],
    description: c.description || 'Targeted learning module for public service officials.'
  }));

  // Normalize text for reliable matching.
  const normalize = value =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Related-word groups. This makes matching smarter than exact words.
  const aliases = {
    'cyber security': [
      'cyber',
      'cybersecurity',
      'security',
      'information security',
      'secure',
      'privacy',
      'data protection',
      'incident',
      'phishing',
      'malware',
      'access control',
      'password',
      'authentication',
      'confidential information'
    ],

    'data visualization': [
      'visualization',
      'visualisation',
      'charts',
      'graphs',
      'dashboard',
      'tableau',
      'data storytelling',
      'visual analytics'
    ],

    'sampling design & weighting': [
      'sampling',
      'sample',
      'survey design',
      'stratified',
      'weighting',
      'estimator',
      'variance'
    ],

    'data interpretation': [
      'data interpretation',
      'interpretation',
      'data analysis',
      'statistical analysis',
      'insights',
      'indicators'
    ],

    'survey data cleaning': [
      'data cleaning',
      'cleaning',
      'data quality',
      'validation',
      'missing data',
      'outlier',
      'preprocessing'
    ],

    'statistical methods': [
      'statistics',
      'statistical methods',
      'probability',
      'regression',
      'hypothesis',
      'inference',
      'statistical analysis'
    ],

    'official statistics ethics': [
      'ethics',
      'confidentiality',
      'privacy',
      'governance',
      'official statistics',
      'data protection',
      'responsible data'
    ]
  };

  const competencyText = normalize(competency);
  const topicText = normalize(topic);

  // Build search terms from competency + topic.
  const terms = new Set();

  if (competencyText) {
    terms.add(competencyText);

    Object.entries(aliases).forEach(([key, words]) => {
      if (
        competencyText.includes(key) ||
        key.includes(competencyText) ||
        words.some(word => competencyText.includes(word))
      ) {
        words.forEach(word => terms.add(normalize(word)));
      }
    });
  }

  if (topicText) {
    terms.add(topicText);

    // Add important individual topic words.
    topicText
      .split(/\s+/)
      .filter(word => word.length >= 4)
      .forEach(word => terms.add(word));

    Object.values(aliases).flat().forEach(word => {
      const normalizedWord = normalize(word);

      if (
        topicText.includes(normalizedWord) ||
        normalizedWord.includes(topicText)
      ) {
        terms.add(normalizedWord);
      }
    });
  }

  // If there is no query, use user's competency gaps.
  if (!competencyText && !topicText) {
    const userGaps = (db.user?.gaps || []).map(normalize);

    return allCourses
      .map(course => {
        const courseText = normalize(
          `${course.title} ${course.description} ${course.skills.join(' ')}`
        );

        const score = userGaps.reduce(
          (total, gap) => total + (gap && courseText.includes(gap) ? 10 : 0),
          0
        );

        return { course, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(item => item.course);
  }

  // Score every course against the requested competency/topic.
    // Score every course against competency and topic.
  const scored = allCourses.map(course => {
    const title = normalize(course.title);
    const description = normalize(course.description);
    const skills = normalize(course.skills.join(' '));

    const courseText = `${title} ${description} ${skills}`;

    let score = 0;
    let topicScore = 0;

    // -------------------------------------------------
    // COMPETENCY MATCH
    // -------------------------------------------------
    if (competencyText) {

      // Exact competency match is strongest.
      if (title.includes(competencyText)) score += 30;
      if (skills.includes(competencyText)) score += 25;
      if (description.includes(competencyText)) score += 15;

      // Related competency keywords.
      Object.entries(aliases).forEach(([key, words]) => {

        const competencyMatchesGroup =
          competencyText.includes(key) ||
          key.includes(competencyText) ||
          words.some(word => competencyText.includes(normalize(word)));

        if (competencyMatchesGroup) {
          words.forEach(word => {
            const term = normalize(word);

            if (title.includes(term)) score += 12;
            if (skills.includes(term)) score += 10;
            if (description.includes(term)) score += 5;
          });
        }
      });
    }

    // -------------------------------------------------
    // PDF / QUIZ TOPIC MATCH
    // -------------------------------------------------
    if (topicText) {

      // Exact topic.
      if (title.includes(topicText)) topicScore += 35;
      if (skills.includes(topicText)) topicScore += 30;
      if (description.includes(topicText)) topicScore += 20;

      // Topic keywords.
      const topicWords = topicText
        .split(/\s+/)
        .filter(word => word.length >= 4);

      topicWords.forEach(word => {
        if (title.includes(word)) topicScore += 8;
        if (skills.includes(word)) topicScore += 6;
        if (description.includes(word)) topicScore += 3;
      });

      // Related security / visualization / statistics terms.
      Object.values(aliases).flat().forEach(word => {
        const term = normalize(word);

        if (
          topicText.includes(term) ||
          term.includes(topicText)
        ) {
          if (title.includes(term)) topicScore += 12;
          if (skills.includes(term)) topicScore += 10;
          if (description.includes(term)) topicScore += 5;
        }
      });
    }

    return { course, score: score + topicScore, topicScore };
  });

  // Only return genuinely relevant resources.
  // NEVER return random courses just to fill the cards.
  // First return strongly relevant topic/competency resources.
const relevant = scored
  // Once a PDF topic is present, do not let an unrelated competency match
  // overshadow it.  The recommendation must remain grounded in that PDF.
  .filter(item => item.score >= 5 && (!topicText || item.topicScore >= 5))
  .sort((a, b) => b.score - a.score)
  .slice(0, 3)
  .map(item => item.course);

if (relevant.length) {
  return relevant;
}

// If the topic is too specific and produced no match,
// fall back to competency-only matching so the learner
// still gets useful resources.
const competencyFallback = allCourses
  .map(course => {
    const title = normalize(course.title);
    const description = normalize(course.description);
    const skills = normalize(course.skills.join(' '));
    const courseText = `${title} ${description} ${skills}`;

    let score = 0;

    if (competencyText && courseText.includes(competencyText)) {
      score += 30;
    }

    Object.entries(aliases).forEach(([key, words]) => {
      const matchesCompetency =
        competencyText.includes(key) ||
        key.includes(competencyText) ||
        words.some(word =>
          competencyText.includes(normalize(word))
        );

      if (matchesCompetency) {
        words.forEach(word => {
          const term = normalize(word);

          if (title.includes(term)) score += 12;
          if (skills.includes(term)) score += 10;
          if (description.includes(term)) score += 5;
        });
      }
    });

    return { course, score };
  })
  .filter(item => item.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 3)
  .map(item => item.course);

if (competencyFallback.length && !topicText) {
  return competencyFallback;
}

// A learner can upload a manual for a domain that is not represented in the
// small, bundled demo catalogue (for example, cyber security).  Returning an
// empty array makes the completed-quiz screen look broken.  Keep the
// recommendation tied to the indexed PDF topic and give the learner a useful
// iGOT discovery link until a fuller catalogue is connected.
const learningFocus = topicText || competencyText || 'public service learning';
const displayFocus = learningFocus
  .split(' ')
  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

return [{
  id: `igot-discovery-${learningFocus.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'learning'}`,
  title: `iGOT Learning Pathway: ${displayFocus}`,
  provider: 'iGOT Karmayogi',
  instructor: 'iGOT Karmayogi',
  duration_hours: 1,
  minutes: 60,
  progress: 0,
  direct_link: 'https://portal.igotkarmayogi.gov.in/page/home',
  skills: [displayFocus],
  description: `Explore iGOT Karmayogi learning resources relevant to the uploaded PDF topic: ${displayFocus}.`
}];
};


const getRadarData = db => {
  const benchmarks = [
    { competency: 'Data Visualization', benchmark: 85, baseScore: 55 },
    { competency: 'Statistical Methods', benchmark: 90, baseScore: 60 },
    { competency: 'Data Interpretation', benchmark: 80, baseScore: 65 },
    { competency: 'Sampling Design & Weighting', benchmark: 85, baseScore: 48 },
    { competency: 'Survey Data Cleaning', benchmark: 80, baseScore: 78 },
    { competency: 'Official Statistics Ethics', benchmark: 85, baseScore: 88 }
  ];

  const userGaps = db.user?.gaps || [];
  const score = Number(db.user?.assessmentScore || 65);
  const bonus = Math.floor(score / 5);

  return benchmarks.map(item => {
    const isGap = userGaps.some(g => g.toLowerCase() === item.competency.toLowerCase());
    const current = isGap
      ? Math.max(35, Math.min(68, item.baseScore + (bonus > 10 ? 5 : 0)))
      : Math.min(100, item.baseScore + bonus);
    return {
      competency: item.competency,
      current_score: current,
      required_benchmark: item.benchmark
    };
  });
};

const buildQuiz = (topic = 'Official Statistics', competency = 'Statistical Methods', count = 5) => {
  const bank = [
    {
      question: `In ${topic}, what is the primary benefit of stratified random sampling over simple random sampling?`,
      options: [
        { id: 'A', text: 'It guarantees representation across heterogeneous sub-populations and lowers sampling variance' },
        { id: 'B', text: 'It avoids having to collect data from remote rural clusters' },
        { id: 'C', text: 'It completely removes the need for data weighting' },
        { id: 'D', text: 'It is always cheaper regardless of sample size' }
      ],
      answer: 'A',
      answerIndex: 0,
      explanation: 'Stratified sampling ensures all critical subgroups (e.g. state, urban/rural strata) are represented with calculated sampling weights.',
      competency
    },
    {
      question: `When communicating official statistical indicators from ${topic}, which chart guideline ensures the highest clarity for policy makers?`,
      options: [
        { id: 'A', text: 'Use a clear takeaway title, explicit axis zero-baselines, and accessible color contrast' },
        { id: 'B', text: 'Plot all raw observations without aggregation or labels' },
        { id: 'C', text: 'Use 3D perspective distortion to make differences look larger' },
        { id: 'D', text: 'Hide the methodology notes to keep the layout concise' }
      ],
      answer: 'A',
      answerIndex: 0,
      explanation: 'Clear takeaway titles and zero-baselines prevent misinterpretation by non-technical administrative leaders.',
      competency
    },
    {
      question: `What should an officer check first when survey returns show an unexpected 30% jump in an economic indicator?`,
      options: [
        { id: 'A', text: 'Verify field capture consistency, outlier flags, and definition or classification changes' },
        { id: 'B', text: 'Publish the number immediately without further validation' },
        { id: 'C', text: 'Discard all records from the lowest-income district' },
        { id: 'D', text: 'Change sample weights arbitrarily until numbers align with prior expectations' }
      ],
      answer: 'A',
      answerIndex: 0,
      explanation: 'Unusual trend deviations require validation of data quality, outlier flags, and classification continuity before publication.',
      competency
    },
    {
      question: `Under the UN Fundamental Principles of Official Statistics, what ensures public trust in national data?`,
      options: [
        { id: 'A', text: 'Impartiality, transparent methodologies, and strictly maintained respondent confidentiality' },
        { id: 'B', text: 'Only sharing data with private commercial buyers' },
        { id: 'C', text: 'Never publishing revisions when errors are detected' },
        { id: 'D', text: 'Restricting survey access exclusively to headquarters personnel' }
      ],
      answer: 'A',
      answerIndex: 0,
      explanation: 'Impartiality, open methodology documentation, and absolute confidentiality of identifiable data are the pillars of official statistics.',
      competency
    },
    {
      question: `Why is comprehensive statistical metadata essential alongside published open datasets?`,
      options: [
        { id: 'A', text: 'It defines concepts, coverage, measurement errors, and proper interpretation boundaries' },
        { id: 'B', text: 'It replaces the need for original raw tables' },
        { id: 'C', text: 'It encrypts the dataset so only licensed tools can read it' },
        { id: 'D', text: 'It is a formality that has no bearing on analysis' }
      ],
      answer: 'A',
      answerIndex: 0,
      explanation: 'Metadata informs users about survey scopes, standard classifications, and sampling margins of error.',
      competency
    }
  ];

  const sliced = bank.slice(0, count);
  return sliced.map((item, idx) => ({
    id: idx + 1,
    question: item.question,
    options: item.options,
    answer: item.answer,
    answerIndex: item.answerIndex,
    explanation: item.explanation,
    competency: item.competency
  }));
};

const buildDocumentQuiz = (document, competency, count) => {
  const topic = document.topics?.[0] || document.name.replace(/\.pdf$/i, '');
  const text = document.extractedText || '';
  // A PDF can contain embedded font glyphs instead of readable text.  Those
  // bytes are not useful evidence and must never become a learner-facing
  // answer choice.
  const isReadableSentence = sentence => {
    const compact = sentence.replace(/\s+/g, ' ').trim();
    const readableChars = (compact.match(/[A-Za-z\s,;:'"“”()\-]/g) || []).length;
    const suspiciousSymbols = (compact.match(/[^A-Za-z0-9\s.,;:'"“”()\-]/g) || []).length;
    const words = compact.match(/[A-Za-z]{3,}/g) || [];
    const naturalWords = words.filter(word => /[aeiouy]/i.test(word));
    return compact.length >= 35 && compact.length <= 280 &&
      readableChars / Math.max(compact.length, 1) >= 0.86 &&
      suspiciousSymbols <= 3 && naturalWords.length >= 7;
  };
  const sentences = text.split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.replace(/\s+/g, ' ').trim())
    .filter(isReadableSentence);
  const fallbackGuidance = /cyber|security|privacy|confidential/i.test(`${topic} ${document.name}`)
    ? 'Follow the documented security controls, protect sensitive information, and report incidents through approved channels.'
    : `Follow the documented procedures, responsibilities, and safeguards described in ${document.name}.`;
  const usesFallbackGuidance = sentences.length === 0;
  const evidence = sentences.length ? sentences : [fallbackGuidance];
  const distractors = [
    'It is unrelated to the uploaded manual.',
    'It should be ignored because source material is optional.',
    'It applies only when no documented procedure exists.'
  ];
  const fallbackQuestions = [
    {
      question: 'What is the most appropriate first action when handling sensitive digital information?',
      answer: fallbackGuidance,
      distractors
    },
    {
      question: 'Which practice best supports secure and compliant information handling?',
      answer: /cyber|security|privacy|confidential/i.test(`${topic} ${document.name}`)
        ? 'Use approved controls consistently and handle sensitive information only through authorised processes.'
        : 'Use approved procedures consistently and record work through the designated process.',
      distractors: ['Use an undocumented workaround whenever it is faster.', 'Share the material without checking access requirements.', 'Treat the documented procedure as optional.']
    },
    {
      question: 'What should an officer do when a potential security issue is identified?',
      answer: /cyber|security|privacy|confidential/i.test(`${topic} ${document.name}`)
        ? 'Escalate the issue through the approved reporting channel and preserve relevant information securely.'
        : 'Escalate the issue through the approved channel and document the action taken.',
      distractors: ['Ignore the issue until the next review cycle.', 'Resolve it privately without informing the responsible team.', 'Delete the records so the issue cannot be traced.']
    },
    {
      question: 'Why are documented security safeguards important?',
      answer: /cyber|security|privacy|confidential/i.test(`${topic} ${document.name}`)
        ? 'They reduce risk to systems and sensitive information while supporting accountable incident handling.'
        : 'They promote consistent, accountable work and reduce operational risk.',
      distractors: ['They remove the need for professional judgement.', 'They are only relevant after an audit has failed.', 'They apply only to external contractors.']
    },
    {
      question: 'Which outcome demonstrates effective protection of sensitive information?',
      answer: /cyber|security|privacy|confidential/i.test(`${topic} ${document.name}`)
        ? 'Sensitive information is protected and potential incidents are handled through documented controls.'
        : 'Work is completed using documented controls, with clear ownership and an auditable record.',
      distractors: ['Controls are bypassed to reduce documentation.', 'Each officer applies a different informal process.', 'Issues are withheld from the responsible authority.']
    }
  ];
  return Array.from({ length: Math.max(1, Math.min(count, 10)) }, (_, idx) => {
    const fallback = usesFallbackGuidance ? fallbackQuestions[idx % fallbackQuestions.length] : null;
    const fact = (fallback?.answer || evidence[idx % evidence.length]).replace(/\s+/g, ' ').trim();
    const keyword = (document.topics || [topic])[idx % (document.topics || [topic]).length];
    return {
      id: idx + 1,
      question: fallback?.question || `Which statement best reflects recommended practice for ${keyword}?`,
      options: [
        { id: 'A', text: fact },
        { id: 'B', text: (fallback?.distractors || distractors)[0] },
        { id: 'C', text: (fallback?.distractors || distractors)[1] },
        { id: 'D', text: (fallback?.distractors || distractors)[2] }
      ],
      answer: 'A', answerIndex: 0,
      explanation: usesFallbackGuidance
        ? `The PDF did not expose readable text, so this is a safe guidance-based question for ${document.name}.`
        : `This answer is based on indexed text from ${document.name}: ${fact}`,
      competency,
      sourceDocumentId: document.id,
      sourceName: document.name
    };
  });
};

const parseQuizJson = content => {
  const match = String(content || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
};

const buildGroqDocumentQuiz = async (document, competency, count) => {
  if (!groqApiKey) throw new Error('Groq is not configured. Add GROQ_API_KEY to backend/.env.');
  const source = document.extractedText.slice(0, 18000);
  const prompt = `Create exactly ${count} distinct multiple-choice questions using only the source text below. Each question must test a different fact, procedure, definition, or relationship from the source. Do not mention the filename, PDF, document, manual, or “source text”. Do not invent facts. Return JSON only in this exact shape: {"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"..."}]}. Use four plausible options per question and keep explanations grounded in the supplied text.\n\nSOURCE TEXT:\n${source}`;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
    body: JSON.stringify({
      model: groqModel,
      temperature: 0.35,
      max_tokens: Math.min(3800, 650 * count),
      messages: [
        { role: 'system', content: 'You create accurate source-grounded assessment questions and return valid JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!response.ok) throw new Error(`Groq quiz generation failed (${response.status}).`);
  const payload = await response.json();
  const parsed = parseQuizJson(payload.choices?.[0]?.message?.content);
  const generated = parsed?.questions;
  if (!Array.isArray(generated) || generated.length < count) throw new Error('Groq returned an incomplete quiz.');
  return generated.slice(0, count).map((item, index) => {
    const options = Array.isArray(item.options) ? item.options.map(value => String(value).trim()).filter(Boolean).slice(0, 4) : [];
    const answerIndex = Number.isInteger(item.answerIndex) && item.answerIndex >= 0 && item.answerIndex < 4 ? item.answerIndex : 0;
    if (!item.question || options.length !== 4) throw new Error('Groq returned an invalid quiz question.');
    return {
      id: index + 1,
      question: String(item.question).trim(),
      options: options.map((text, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text })),
      answer: String.fromCharCode(65 + answerIndex),
      answerIndex,
      explanation: String(item.explanation || 'This answer is supported by the uploaded content.').trim(),
      competency,
      sourceDocumentId: document.id,
      sourceName: document.name
    };
  });
};

const api = async (req, res, url) => {
  const db = readDb();
  const pathname = url.pathname;

  // Health check
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
    return send(res, 200, { status: 'ok', service: 'Pragati AI API', timestamp: new Date().toISOString() });
  }

  // Local authentication. Passwords are salted and hashed; responses never expose hashes.
  if (req.method === 'POST' && (pathname === '/api/auth/signup' || pathname === '/auth/signup')) {
    const payload = await parseBody(req);
    const username = String(payload.username || payload.name || '').trim();
    const name = String(payload.name || username).trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return send(res, 422, { error: 'Username must be 3–30 characters and use only letters, numbers, dots, hyphens, or underscores.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 422, { error: 'Enter a valid email address.' });
    if (password.length < 8) return send(res, 422, { error: 'Password must contain at least 8 characters.' });
    db.users = db.users || [];
    if (db.users.some(user => user.email === email)) return send(res, 409, { error: 'An account already exists for this email address.' });
    if (db.users.some(user => String(user.username || user.name).toLowerCase() === username.toLowerCase())) return send(res, 409, { error: 'That username is already taken.' });
    const user = {
      id: 'OFFICER_' + randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(),
      name,
      username,
      initials: username.slice(0, 2).toUpperCase(),
      email,
      role: String(payload.role || 'Statistical Officer').trim().slice(0, 80),
      organization: String(payload.organization || 'MoSPI Learning Hub').trim().slice(0, 120),
      passwordHash: passwordHash(password),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDb(db);
    return send(res, 201, { token: 'local-session-' + randomUUID(), user: publicUser(user) });
  }

  if (req.method === 'POST' && (pathname === '/api/auth/login' || pathname === '/auth/login')) {
    const payload = await parseBody(req);
    const identifier = String(payload.identifier || payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');
    const user = (db.users || []).find(candidate => candidate.email === identifier || String(candidate.username || candidate.name).toLowerCase() === identifier);
    if (!user || !passwordMatches(password, user.passwordHash)) return send(res, 401, { error: 'Incorrect email or password.' });
    return send(res, 200, { token: 'local-session-' + randomUUID(), user: publicUser(user) });
  }
  if (req.method === 'GET' && (pathname === '/api/me' || pathname === '/me')) {
    return send(res, 200, db.user);
  }

  // Dashboard
  if (req.method === 'GET' && (pathname === '/api/dashboard' || pathname === '/dashboard')) {
    return send(res, 200, {
      user: db.user,
      courses: db.courses,
      recommendations: getRecommendations(db),
      events: db.events,
      skills: db.skills,
      radar: getRadarData(db),
      analytics: db.analytics
    });
  }

  // Courses
  if (req.method === 'GET' && (pathname === '/api/courses' || pathname === '/courses')) {
    return send(res, 200, db.courses);
  }

  // Assessment definition
  if (req.method === 'GET' && (pathname === '/api/assessment' || pathname === '/assessment')) {
    return send(res, 200, db.assessment);
  }

  // Admin Analytics
  if (req.method === 'GET' && (pathname === '/api/admin/analytics' || pathname === '/admin/analytics')) {
    return send(res, 200, db.analytics);
  }

  // Competencies profile (contract & API)
  if (req.method === 'GET' && (pathname.startsWith('/competencies/profile/') || pathname.startsWith('/api/competencies/profile/'))) {
    const officerId = pathname.split('/').pop() || db.user.id;
    const radarData = getRadarData(db);
    return send(res, 200, {
      officer_id: officerId,
      officer: db.user,
      radar_data: radarData,
      gaps: db.user.gaps,
      skills: db.skills,
      last_assessment: db.user.lastAssessment
    });
  }

  // iGOT Recommendations (contract & API)
  if (
  req.method === 'GET' &&
  (
    pathname.startsWith('/igot/recommendations/') ||
    pathname.startsWith('/api/igot/recommendations/')
  )
) {
  const rawCompetency = decodeURIComponent(
    pathname.split('/').pop() || ''
  );

  const topic = url.searchParams.get('topic') || '';

  const recs = getRecommendations(
    db,
    rawCompetency,
    topic
  );

  return send(res, 200, recs);
}

  // Update learning progress
  if (req.method === 'POST' && (pathname === '/api/progress' || pathname === '/progress')) {
    const payload = await parseBody(req);
    const course = (db.courses || []).find(c => c.id === payload.courseId);
    if (!course) return send(res, 404, { error: 'Course not found' });

    const addedProgress = Number(payload.progressIncrement || payload.progress || 20);
    course.progress = Math.min(100, Math.max(course.progress || 0, (course.progress || 0) + addedProgress));

    const addedMinutes = Number(payload.minutes || 30);
    db.user.learningTime = Number(((db.user.learningTime || 200) + (addedMinutes / 60)).toFixed(1));

    writeDb(db);
    return send(res, 200, {
      status: 'success',
      course,
      learningTime: db.user.learningTime,
      message: `Progress updated: ${course.progress}% completed.`
    });
  }

  // Submit assessment
  if (req.method === 'POST' && (pathname === '/api/assessment/submit' || pathname === '/assessment/submit')) {
    const { answers = [] } = await parseBody(req);
    const questions = db.assessment?.questions || [];
    let correctCount = 0;

    questions.forEach((q, idx) => {
      if (answers[idx] === q.answer) correctCount++;
    });

    const total = questions.length || 5;
    const score = Math.round((correctCount / total) * 100);

    let updatedGaps = [];
    if (score < 60) {
      updatedGaps = ['Data Visualization', 'Statistical Methods', 'Data Interpretation', 'Sampling Design & Weighting'];
    } else if (score < 80) {
      updatedGaps = ['Data Visualization', 'Sampling Design & Weighting'];
    } else {
      updatedGaps = ['Sampling Design & Weighting'];
    }

    db.user.assessmentScore = score;
    db.user.gaps = updatedGaps;
    db.user.skillsMastered = score >= 70 ? 20 : 16;
    db.user.lastAssessment = new Date().toISOString();
    writeDb(db);

    return send(res, 200, {
      score,
      correctCount,
      total,
      gaps: updatedGaps,
      recommendations: getRecommendations(db),
      radar: getRadarData(db)
    });
  }

  // Quiz generation
  if (req.method === 'POST' && (pathname === '/quiz/generate' || pathname === '/api/quizzes/generate' || pathname === '/api/quiz/generate')) {
    const payload = await parseBody(req);
    const sourceDocument = (db.documents || []).find(document => document.id === payload.sourceDocumentId || document.name === payload.sourceName);
    const topic = sourceDocument?.topics?.[0] || payload.topic || 'Official Statistics';
    const competency = payload.competency || 'Statistical Methods';
    const numQuestions = Math.max(1, Math.min(Number(payload.num_questions || payload.questionCount || 5) || 5, 10));
    const sourceName = sourceDocument?.name || payload.sourceName || 'National Training Framework';

    if (sourceDocument && !['pypdf', 'groq-vision'].includes(sourceDocument.extractionMethod)) {
      return send(res, 422, { error: 'This older upload was not indexed from readable PDF text. Upload the PDF again to generate source-grounded questions.' });
    }
    let questions;
    if (sourceDocument) {
      try {
        questions = await buildGroqDocumentQuiz(sourceDocument, competency, numQuestions);
      } catch (error) {
        console.warn('Groq generation failed; using source-grounded fallback:', error.message);
        questions = buildDocumentQuiz(sourceDocument, competency, numQuestions);
      }
    } else {
      questions = buildQuiz(topic, competency, numQuestions);
    }

    db.quizHistory = db.quizHistory || [];
    db.quizHistory.unshift({
      id: randomUUID(),
      topic,
      competency,
      sourceName,
      sourceDocumentId: sourceDocument?.id || null,
      createdAt: new Date().toISOString(),
      questionCount: questions.length
    });
    if (db.quizHistory.length > 20) db.quizHistory = db.quizHistory.slice(0, 20);
    writeDb(db);

    return send(res, 200, {
      sourceName,
      topic,
      competency,
      questions,
      quiz: questions
    });
  }

  // Quiz evaluation
  if (req.method === 'POST' && (pathname === '/quiz/evaluate' || pathname === '/api/quiz/evaluate')) {
    const payload = await parseBody(req);
    const submissions = payload.submissions || [];
    const competency = payload.competency || 'Statistical Methods';

    const total = submissions.length || 5;
    const correctCount = submissions.filter(submission => {
      const selected = String(submission.selected_option_id || '').trim().toUpperCase();
      const correct = String(submission.correct_option_id || '').trim().toUpperCase();
      return /^[A-D]$/.test(selected) && selected === correct;
    }).length;
    const scorePercentage = submissions.length ? Math.round((correctCount / total) * 100) : 0;

    const isProficient = scorePercentage >= 70;
    if (isProficient && db.user.gaps.includes(competency)) {
      db.user.gaps = db.user.gaps.filter(g => g.toLowerCase() !== competency.toLowerCase());
      db.user.skillsMastered = (db.user.skillsMastered || 16) + 1;
    }
    // Keep the dashboard score in sync with the latest submitted quiz.
    db.user.assessmentScore = scorePercentage;
    db.user.lastAssessment = new Date().toISOString();
    db.user.learningStreak = (db.user.learningStreak || 12) + 1;
    writeDb(db);

    return send(res, 200, {
      officer_id: payload.officer_id || db.user.id,
      competency,
      score_percentage: scorePercentage,
      status: isProficient ? 'Proficient' : 'Needs Focus',
      correct_count: correctCount,
      total,
      assessment_score: scorePercentage,
      remaining_gaps: db.user.gaps
    });
  }

  // Documents list & upload
  if (req.method === 'GET' && (pathname === '/documents' || pathname === '/api/documents')) {
    return send(res, 200, db.documents || []);
  }

  if (req.method === 'DELETE' && (pathname === '/documents' || pathname === '/api/documents')) {
    const uploadsRoot = path.resolve(uploadedFilesDir);
    for (const document of db.documents || []) {
      const savedPath = path.resolve(root, document.storedPath || '');
      if (savedPath.startsWith(`${uploadsRoot}${path.sep}`) && fs.existsSync(savedPath)) {
        fs.unlinkSync(savedPath);
      }
    }
    db.documents = [];
    writeDb(db);
    return send(res, 200, { status: 'success', message: 'All indexed manuals have been cleared.', documents: [] });
  }

  if (req.method === 'POST' && (pathname === '/documents/upload' || pathname === '/api/documents/upload')) {
    const body = await readBody(req);
    const multipart = parseMultipart(body, req.headers['content-type']);
    const uploadedFile = multipart?.file;
    if (!uploadedFile) {
      return send(res, 400, { error: 'A PDF file is required in the multipart form-data field "file".' });
    }
    if (!/\.pdf$/i.test(uploadedFile.filename)) {
      return send(res, 400, { error: 'Only PDF files can be uploaded.' });
    }
    const filename = uploadedFile.filename;
    const size = `${(uploadedFile.buffer.length / (1024 * 1024)).toFixed(2)} MB`;
    const documentId = 'doc-' + randomUUID().slice(0, 8);

  // Extract text directly from the uploaded PDF buffer
    let extractedText = extractPdfText(uploadedFile.buffer);
    let extractionMethod = 'javascript';

    if (extractedText.length < 40) {
      return send(res, 422, {
      error: 'No readable text could be extracted from this PDF. Please upload a text-based PDF.'
      });
    }
    if (extractedText.length < 40) {
      return send(res, 422, { error: 'No readable text could be extracted. The PDF may be blank, password-protected, or OCR is not configured for scanned documents.' });
    }
    const topics = deriveTopics(extractedText, filename);

    const newDoc = {
      id: documentId,
      name: filename,
      size,
      uploadedAt: new Date().toISOString(),
      status: 'Indexed & Ready',
      topics,
      extractedText,
      extractedCharacters: extractedText.length,
      extractionMethod,
      storedPath: ''
    };

    db.documents = db.documents || [];
    db.documents.unshift(newDoc);
    writeDb(db);

    return send(res, 200, {
      status: 'success',
      message: `${filename} successfully uploaded, scanned, and indexed for source-based quizzes.`,
      document: newDoc,
      documents: db.documents
    });
  }

  return send(res, 404, { error: 'API endpoint not found: ' + pathname });
};

const requestHandler = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost:4174'}`);

  try {
    const isApi = url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/competencies/') ||
      url.pathname.startsWith('/igot/') ||
      url.pathname.startsWith('/quiz/') ||
      url.pathname.startsWith('/documents');

    if (isApi) {
      return await api(req, res, url);
    }

    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(root, requested);

    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    console.error('Server error:', error);
    send(res, 500, { error: 'Internal Server Error' });
  }
};

const server = http.createServer(requestHandler);

const PORT = process.env.PORT || 4174;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`StatKarm AI is running at http://localhost:${PORT}`);
  });
}

module.exports = requestHandler;
