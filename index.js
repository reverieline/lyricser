// app.js - Main application file
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const pptxgen = require('pptxgenjs');
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

// Make output presentation path
function makePresentationFilename() {
  const now = new Date();
  
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(now.getDate()).padStart(2, '0');

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `Songs-${year}-${month}-${day}_${hours}${minutes}`;
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
    const filePath = path.join(LYRICS_DIR, req.params.filename);
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    console.error('Error reading song file:', error);
    res.status(404).json({ error: 'Song file not found' });
  }
});

// Save updated song content
router.use('/api/songs/:filename', basicAuth);
router.post('/api/songs/:filename', async (req, res) => {
  try {
    const filePath = path.join(LYRICS_DIR, req.params.filename);
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
    const fileName = req.body.fileName.endsWith('.txt') ? 
      req.body.fileName : `${req.body.fileName}.txt`;
    const filePath = path.join(LYRICS_DIR, fileName);
    
    // Check if file already exists
    try {
      await fs.access(filePath);
      return res.status(400).json({ error: 'File already exists' });
    } catch {
      // File doesn't exist, we can proceed
    }
    
    await fs.writeFile(filePath, req.body.content || '');
    res.json({ success: true, fileName });
  } catch (error) {
    console.error('Error creating song file:', error);
    res.status(500).json({ error: 'Failed to create song file' });
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
      
      // Split the content by slides (typically separated by blank lines)
      const slides = content.split(/\n\s*\n/).filter(slide => slide.trim());
      
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
    const outputPath = path.join(__dirname, 'temp', makePresentationFilename()+'.pptx');
    
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
