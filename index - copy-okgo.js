const express = require('express');
const {Configuration, OpenAIApi} = require("openai");
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
require("dotenv").config();

//记录日志模块
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} ${level}: ${message}`;
      })
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: 'application.log' })
    ]
  });


const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.use(cors());
app.use(express.json());
app.use('/', express.static(__dirname + '/client')); // Serves resources from client folder

// Read password file
let users = [];
fs.readFile(path.join(__dirname, 'passwords.txt'), function(err, data) {
  if (err) {
    console.error(err);
  } else {
    users = data.toString().split('\n');
  }
});

// Handle POST request
app.post('/submit-form', function (req, res) {
    console.log('Request body:', req.body); // Add this line for debugging
  
    const username = req.body.username;
    const password = req.body.password;
  
    // Check username and password
    for (let i = 0; i < users.length; i++) {
      const fields = users[i].split(' ');
      if (fields[0] === username && fields[1] === password) {
        logger.info(`User ${username} logged in successfully.`);
        res.status(200).send('success');
        return;
      }
    }
  
    res.status(401).send('failure');
    logger.warn(`Failed login attempt for user ${username}.`);
  });
  
// Set up Multer to handle file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, 'uploads/')
        },
        filename: function (req, file, cb) {
            const extension = path.extname(file.originalname);
            const filename = uuidv4() + extension;
            cb(null, filename);
        }
    }),
    limits: { fileSize: 1024 * 1024 * 10 }, // 10 MB
    fileFilter: function (req, file, cb) {
        const allowedExtensions = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];
        const extension = path.extname(file.originalname);
        if (allowedExtensions.includes(extension)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type.'));
        }
    }
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        const resp = await openai.createTranscription(
            fs.createReadStream(req.file.path),
            "whisper-1",
            'text'
        );
        return res.send(resp.data.text);
    } catch (error) {
        const errorMsg = error.response ? error.response.data.error : `${error}`;
        console.log(errorMsg)
        return res.status(500).send(errorMsg);
    } finally {
        fs.unlinkSync(req.file.path);
    }
});

app.post('/get-prompt-result', async (req, res) => {
    // Get the prompt from the request body
    const {prompt, model = 'gpt'} = req.body;
    logger.info(`User input: ${prompt}`);
    logger.info(`Model: ${model}`);

    // Check if prompt is present in the request
    if (!prompt) {
        // Send a 400 status code and a message indicating that the prompt is missing
        return res.status(400).send({error: 'Prompt is missing in the request'});
    }

    try {
        // Use the OpenAI SDK to create a completion
        // with the given prompt, model and maximum tokens
        if (model === 'image') {
            const result = await openai.createImage({
                prompt,
                response_format: 'url',
                size: '512x512'
            });
            return res.send(result.data.data[0].url);
        }
        if (model === 'chatgpt') {
            const result = await openai.createChatCompletion({
                model:"gpt-3.5-turbo",
                messages: [
                    { role: "user", content: prompt }
                ]
            })
            return res.send(result.data.choices[0]?.message?.content);
        }
        const completion = await openai.createCompletion({
            model: model === 'gpt' ? "text-davinci-003" : 'code-davinci-002', // model name
            prompt: `Please reply below question in markdown format.\n ${prompt}`, // input prompt
            max_tokens: model === 'gpt' ? 4000 : 8000 // Use max 8000 tokens for codex model
        });
        // Send the generated text as the response
        return res.send(completion.data.choices[0].text);
    } catch (error) {
        const errorMsg = error.response ? error.response.data.error : `${error}`;
        console.error(errorMsg);
        // Send a 500 status code and the error message as the response
        return res.status(500).send(errorMsg);
    }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Listening on port ${port}`));
