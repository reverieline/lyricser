// app.js - Main application file
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const pptxgen = require('pptxgenjs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const bodyParser = require('body-parser');
const auth = require('basic-auth');

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '/';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Middleware
app.use(BASE_PATH,router);
router.use(express.static('public'));
router.use(bodyParser.json());

// Lyrics directory - adjust path as needed
const LYRICS_DIR = path.join(__dirname, 'lyrics');
const NORMALIZED_LYRICS_DIR = path.resolve(LYRICS_DIR);

function normalizeSongFileName(fileName) {
  if (typeof fileName !== 'string') {
    return null;
  }

  const trimmed = fileName.trim();
  if (!trimmed) {
    return null;
  }

  const canonicalFileName = trimmed.endsWith('.txt') ? trimmed : `${trimmed}.txt`;
  if (path.basename(canonicalFileName) !== canonicalFileName) {
    return null;
  }

  const baseName = path.basename(canonicalFileName, '.txt');
  if (
    !baseName ||
    /[<>:"/\\|?*\x00-\x1F]/.test(baseName) ||
    /[. ]$/.test(baseName) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)
  ) {
    return null;
  }

  const filePath = path.resolve(NORMALIZED_LYRICS_DIR, canonicalFileName);
  const relativePath = path.relative(NORMALIZED_LYRICS_DIR, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return { fileName: canonicalFileName, filePath };
}

function resolveSongFilePath(fileName) {
  const normalized = normalizeSongFileName(fileName);
  return normalized ? normalized.filePath : null;
}

// Basic Auth
const basicAuth = (req, res, next) => {
  const user = auth(req);

  //NO RESTRICTIONS
  if(ADMIN_USERNAME=='')
    return next();

  if (!user || user.name !== ADMIN_USERNAME || user.pass !== ADMIN_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="edit"');
    return res.status(401).send('Authentication required.');
  }

  next();
};

// Ensure lyrics directory exists
async function ensureLyricsDir() {
  try {
    await fs.access(LYRICS_DIR);
  } catch {
    await fs.mkdir(LYRICS_DIR, { recursive: true });
  }
}

// Make output export path
function makeExportFilename(extension) {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(now.getDate()).padStart(2, '0');

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;

  return `Songs-${year}-${month}-${day}_${hours}${minutes}${normalizedExtension}`;
}

async function buildDocxBuffer(playlist) {
  const sections = [];

  for (const songFile of playlist) {
    const filePath = path.join(LYRICS_DIR, songFile);
    const content = await fs.readFile(filePath, 'utf8');
    const title = path.basename(songFile, path.extname(songFile));
    const lines = content.split(/\r?\n/);

    if (sections.length > 0) {
      sections.push(new Paragraph({ text: '' }));
    }

    sections.push(
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 28 })],
        heading: HeadingLevel.HEADING_1,
      })
    );
    sections.push(new Paragraph({ text: '' }));

    for (const line of lines) {
      sections.push(new Paragraph({ text: line }));
    }
  }

  const document = new Document({
    sections: [{ children: sections }],
  });

  return Packer.toBuffer(document);
}

// Get all available lyrics files
router.get('/api/songs', async (req, res) => {
  try {
    await ensureLyricsDir();
    const files = await fs.readdir(LYRICS_DIR);
    const txtFiles = files.filter(file => file.endsWith('.txt'));
    res.json({ songs: txtFiles });
  } catch (error) {
    console.error('Error reading songs:', error);
    res.status(500).json({ error: 'Failed to read songs directory' });
  }
});

// Get content of a specific song file
router.get('/api/songs/:filename', async (req, res) => {
  try {
    const filePath = resolveSongFilePath(req.params.filename);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid song filename' });
    }

    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Song file not found' });
    }

    console.error('Error reading song file:', error);
    res.status(500).json({ error: 'Failed to read song file' });
  }
});

// Save updated song content
router.use('/api/songs/:filename', basicAuth);
router.post('/api/songs/:filename', async (req, res) => {
  try {
    const filePath = resolveSongFilePath(req.params.filename);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid song filename' });
    }

    await fs.writeFile(filePath, req.body.content);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving song file:', error);
    res.status(500).json({ error: 'Failed to save song file' });
  }
});

// Create a new song file
router.use('/api/songs', basicAuth);
router.post('/api/songs', async (req, res) => {
  try {
    await ensureLyricsDir();

    const normalized = normalizeSongFileName(req.body.fileName);

    if (!normalized) {
      return res.status(400).json({ error: 'Invalid song filename' });
    }

    const { fileName: requestedFileName, filePath } = normalized;

    // Check if file already exists
    try {
      await fs.access(filePath);
      return res.status(400).json({ error: 'File already exists' });
    } catch {
      // File doesn't exist, we can proceed
    }

    await fs.writeFile(filePath, req.body.content || '');
    res.json({ success: true, fileName: requestedFileName });
  } catch (error) {
    console.error('Error creating song file:', error);
    res.status(500).json({ error: 'Failed to create song file' });
  }
});

router.delete('/api/songs/:filename', async (req, res) => {
  try {
    const filePath = resolveSongFilePath(req.params.filename);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid song filename' });
    }

    await fs.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Song file not found' });
    }

    console.error('Error deleting song file:', error);
    res.status(500).json({ error: 'Failed to delete song file' });
  }
});

router.post('/api/songs/:filename/rename', async (req, res) => {
  try {
    const sourcePath = resolveSongFilePath(req.params.filename);
    if (!sourcePath) {
      return res.status(400).json({ error: 'Invalid song filename' });
    }

    const normalized = normalizeSongFileName(req.body.newTitle);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid song filename' });
    }

    const sourceFileName = path.basename(sourcePath);
    const { fileName: targetFileName, filePath: targetPath } = normalized;

    try {
      await fs.access(sourcePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Song file not found' });
      }

      throw error;
    }

    if (targetFileName === sourceFileName) {
      return res.json({ success: true, fileName: sourceFileName });
    }

    try {
      await fs.access(targetPath);
      return res.status(409).json({ error: 'A song with that name already exists' });
    } catch {
      // Destination does not exist, we can proceed.
    }

    await fs.rename(sourcePath, targetPath);
    res.json({ success: true, fileName: targetFileName });
  } catch (error) {
    console.error('Error renaming song file:', error);
    res.status(500).json({ error: 'Failed to rename song file' });
  }
});

// Generate PPTX from playlist
router.post('/api/generate-pptx', async (req, res) => {
  try {
    const { playlist } = req.body;
    
    // Create a new presentation
    const pres = new pptxgen();
    const _ph=pres.presLayout.height;
    const _pw=pres.presLayout.width;

    // Master slide
    pres.defineSlideMaster({
      title: "MASTER_SLIDE",
      background: { color: "000000" },
      objects: [
        { placeholder: { 
          options: { 
            name: "body", 
            type: "body",
            x: "0%",
            y: "0%",
            w: "100%",
            h: "100%",
            fontSize: 40,
            color: "FFFFFF",
            align: "center",
            valign: "middle",
           } } },
           {
            image: {
              x: "2%",
              y: "80%",
              w: 1.0,
              // h: 1.0,
              path: "./public/logo.png",
              opacity: 0.5                          // 50% transparency
            }
          },
      ],
      // slideNumber: { x: 0.5, y: "90%" }
    });


    
    // Process each song in the playlist
    for (const songFile of playlist) {
      const filePath = path.join(LYRICS_DIR, songFile);
      const content = await fs.readFile(filePath, 'utf8');

      // Strip comment lines before splitting into slides
      const contentWithoutComments = content
        .split(/\r?\n/)
        .filter(line => !line.trimStart().startsWith('#'))
        .join('\n');

      // Split the content by slides (typically separated by blank lines)
      const slides = contentWithoutComments.split(/\n\s*\n/).filter(slide => slide.trim());
      
      // Add song title slide
      // const titleSlide = pres.addSlide();
      // titleSlide.addText(songFile.replace('.txt', ''), {
      //   x: 1,
      //   y: 2.5,
      //   fontSize: 44,
      //   color: '363636',
      //   bold: true,
      //   align: 'center'
      // });

      //Empty slide at the begining of each song
      pres.addSlide({ masterName: "MASTER_SLIDE" });
      
      // Add each lyric slide
      for (const slideContent of slides) {
        if (slideContent.trim()) {
          const slide = pres.addSlide({ masterName: "MASTER_SLIDE" });
          slide.addText(slideContent,{placeholder: 'body'});
          // slide.addText(slideContent.trim(), {
          //   x: 0.5,
          //   y: 0.5,
          //   w: '95%',
          //   h: '90%',
          //   fontSize: 28,
          //   color: '363636',
          //   align: 'center',
          //   valign: 'middle'
          // });
        }
      }
    }

    //Empty slide at the end of all songs
    pres.addSlide({ masterName: "MASTER_SLIDE" });
    
    // Save the presentation temporarily
    // const outputPath = path.join(__dirname, 'temp', 'presentation.pptx');
    const outputPath = path.join(__dirname, 'temp', makeExportFilename('.pptx'));
    
    // Ensure temp directory exists
    await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
    
    // Write file as buffer
    const pptxBuffer = await pres.write({ outputType: 'nodebuffer' });
    await fs.writeFile(outputPath, pptxBuffer);
    
    // Send the file and then delete it
    res.download(outputPath, null, async (err) => {
      if (err) console.error('Error sending file:', err);
      
      // Attempt to delete the temporary file
      try {
        await fs.unlink(outputPath);
      } catch (deleteErr) {
        console.error('Error deleting temporary file:', deleteErr);
      }
    });
    
  } catch (error) {
    console.error('Error generating presentation:', error);
    res.status(500).json({ error: 'Failed to generate presentation' });
  }
});

router.post('/api/generate-docx', async (req, res) => {
  try {
    const { playlist } = req.body;

    if (!Array.isArray(playlist) || playlist.length === 0) {
      return res.status(400).json({ error: 'Playlist is required' });
    }

    const docxBuffer = await buildDocxBuffer(playlist);
    const filename = makeExportFilename('.docx');

    res.attachment(filename);
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(docxBuffer);
  } catch (error) {
    console.error('Error generating DOCX:', error);
    res.status(500).json({ error: 'Failed to generate DOCX' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
