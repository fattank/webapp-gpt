const express = require('express');
const {Configuration, OpenAIApi} = require("openai");
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const { text } = require('body-parser');
const db = new sqlite3.Database('webapp.db');


app.use((req, res, next) => {
  console.log(req.method, req.url, req.body);
  next();
});

function updateRemainingQuestions() {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/get-remaining-questions', true);
  xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
          if (xhr.status === 200) {
              const data = JSON.parse(xhr.responseText);
              const remainingQuestions = data.remainingQuestions;
              document.getElementById('question-count').textContent = remainingQuestions;
          } else {
              console.error('Error fetching remaining questions:', xhr.status, xhr.statusText);
          }
      }
  };
  xhr.send();
}

app.post('/deduct-remaining-questions', (req, res) => {
  console.log("Received data:", req.body);
  res.send('text')
  // deduct remaining questions logic here
});

require("dotenv").config();

//logs
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message, ip }) => {
        return `${timestamp} ${level}: ${message} ${ip ? `IP: ${ip}` : ''}`;
      })
    ),
    //do a logs
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: 'application.log' })
    ]
  });

//read apikey
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

//index.html
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/', express.static(__dirname + '/client')); // Serves resources from client folder
app.use(
    session({
      secret: 'your_secret_key',
      resave: false,
      saveUninitialized: true,
      cookie: { maxAge: 24 * 60 * 60 * 1000 }, // talking  24 小时
    })
  );


//read users count
db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT,
        password TEXT,
        count INTEGER
      )
    `, (err) => {
        if (err) {
            console.error(err.message);
        }
    });
});


// loging
app.post('/submit-form', function (req, res) {
    console.log("Received data:", req.body); // log sea the server back
    const { username, password } = req.body;
    if (req.session.username === username) {// Check if the user is already logged in
      res.status(403).send('This user is already logged in.');
      return;
    }
    const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
    db.get(checkUserQuery, [username], (err, row) => {
      if (err) {
        console.error(err.message);
        res.status(500).send('Internal server error');
        return;
      }

      if (!row || row.password !== password) {
        res.status(401).send('Invalid username or password');
        logger.warn(`Login failed for username: ${username}`); //fild
        return;
      }
      // good to go
      req.session.username = username;
      req.session.questionCount = row.count; // save users count in session
      res.status(200).send('success');
    });
  });

    // asking
    app.post('/ask-question', function (req, res) {
      console.log("Received data:", req.body);
      if (!req.session.username || req.session.questionCount <= 0) {
          res.status(403).send('No more questions allowed');
          return;
      }
      function updateQuestionCount(username) {
        return new Promise((resolve, reject) => {
          const query = 'UPDATE users SET count = count - 1 WHERE username = ?';
          db.run(query, [username], function (err) {
              if (err) {
                  console.error('Error updating question count:', err);
                  reject(err);
                  return;
              }
              console.log('Question count updated for user:', username);
              resolve();
          });
        });
    }
    (async () => {
      try {
          // Update the question count for the user
          await updateQuestionCount(req.session.username);
          // reload count
          req.session.questionCount -= 1;
          if (req.session.questionCount <= 0) {
              res.status(200).send({ message: 'No more questions allowed. Please recharge.' });
          } else {
              res.status(200).send({ message: 'Question processed successfully' });
          }
      } catch (err) {
        console.error('Error:', err);
        res.status(500).send("Internal server error");
      }
  })();
});
app.post('/update-count', (req, res) => { //use sumbit-botton update count
    // Extract any necessary data from the request body, e.g., the user's ID
    // const userId = req.body.userId;
    console.log("Received data:", req.body);
    // Update the user's count in the database
    const query = 'UPDATE users SET count = count - 1 WHERE username = ?'; //+1or-1
    db.run(query, [req.session.username], function (err) {
        if (err) {
            console.error('Error updating user count:', err);
            res.status(500).send({ message: 'Internal server error' });
            return;
        }

        // Send a success message or the updated count back to the client
        res.status(200).send({ message: 'Count updated successfully' });
    });
});
//updat count send to html
app.get('/get-question-count', (req, res) => {
    console.log("Received data:", req.body);
    const query = 'SELECT count FROM users WHERE username = ?';
    db.get(query, [req.session.username], (err, row) => {
      if (err) {
        console.error('Error fetching question count:', err);
        res.status(500).send({ message: 'Internal server error' });
        return;
      }
      if (row) {
        res.status(200).send({ count: row.count });
      } else {
        res.status(404).send({ message: 'User not found' });
      }
    });
  });


//count number send back to mainhtml
    app.get('/get-remaining-questions', function (req, res) {
      console.log("Received data:", req.body);
      if (!req.session.username) {
      res.status(403).send('Not logged in');
      return;
      }

  const username = req.session.username;
  const query = 'SELECT count FROM users WHERE username = ?';
  db.get(query, [username], (err, row) => {
      if (err) {
          console.error(err.message);
          res.status(500).send('Internal server error');
          return;
      }

      if (row) {
          // Log the remaining question count for the user
          logger.info(`Remaining questions for user '${username}': ${row.count}`);

          res.status(200).send({ remainingQuestions: row.count });
      } else {
          res.status(404).send('User not found');
      }
  });
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
    const userIP = req.ip; // Get the user's IP address
  //  logger.info(`User input: ${prompt}`, {ip: userIP});
  //  logger.info(`Model: ${model}`, {ip: userIP});

  // 检测session
  if(!req.session?.username){
    res.status(403).send('Not logged in');
    return;
  }

  // 检测计数
  try{
    let iAvailCount = await detectAccountAvailCount(req.session.username);
    console.log("剩余计数：",iAvailCount);
  }
  catch(err){
    console.error('Error:', err);
    res.status(500).send(`${err.message||""}`);
    return;
  }

  // -- 1⃣️这里获取调用open api获取回答....（自己补充代码）
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
    else if (model === 'chatgpt') {
        const result = await openai.createChatCompletion({
            model:"gpt-3.5-turbo",
            messages: [

              temperature=0.9,  # 值在[0,1]之间，越大表示回复越具有不确定性
                top_p=1,
                frequency_penalty=0.0,  # [-2,2]之间，该值越大则更倾向于产生不同的内容
                presence_penalty=0.0,  # [-2,2]之间，该值越大则更倾向于产生不同的内容
                { role: "user", content: prompt }
            ]
        })
        responseText = result.data.choices[0]?.message?.content;
    }else {
        const completion = await openai.createCompletion({
            model: model === 'gpt' ? "text-davinci-003" : 'code-davinci-002', // model name
            prompt: `Please reply below question in markdown format.\n ${prompt}`, // input prompt
            max_tokens: model === 'gpt' ? 4000 : 8000 // Use max 8000 tokens for codex model
    });



  // -- 2⃣️这里更新计数
    const query = 'UPDATE users SET count = count - 1 WHERE username = ?'; //+1or-1
    db.run(query, [req.session.username], function (err) {
      if (err) {
        console.error('Error updating user count:', err);
        res.status(500).send({ message: 'Internal server error' });
        return;
      }

      // Send a success message or the updated count back to the client
      // res.status(200).send({ message: 'Count updated successfully' });
    });

    // 上面两个都成功了返回答案，这里为了测试写死了
    //res.send('回答了！');
  //return;

/*      // Check if prompt is present in the request
    // if (!prompt) {
        // Send a 400 status code and a message indicating that the prompt is missing
        // return res.status(400).send({error: 'Prompt is missing in the request'});
    // }

    // try {
        // Use the OpenAI SDK to create a completion
        // with the given prompt, model and maximum tokens
        // if (model === 'image') {
            // const result = await openai.createImage({
                // prompt,
                // response_format: 'url',
                // size: '512x512'
            // });
        // return res.send(result.data.data[0].url);
        // }
        // else if (model === 'chatgpt') {
            const result = await openai.createChatCompletion({
                model:"gpt-3.5-turbo",
                messages: [
                    { role: "user", content: prompt }
                ]
            })
            responseText = result.data.choices[0]?.message?.content;
        }else {
            const completion = await openai.createCompletion({
                model: model === 'gpt' ? "text-davinci-003" : 'code-davinci-002', // model name
                prompt: `Please reply below question in markdown format.\n ${prompt}`, // input prompt
                max_tokens: model === 'gpt' ? 4000 : 8000 // Use max 8000 tokens for codex model
        });*/
        // Send the generated text as the response
            responseText = completion.data.choices[0].text;
    }
    logger.info(`System response: ${responseText}`);
        return res.send(responseText);

    } catch (error) {
        const errorMsg = error.response ? error.response.data.error : `${error}`;
        console.error(errorMsg);
        // Send a 500 status code and the error message as the response
        return res.status(500).send(errorMsg);
    }
});


const port = process.env.PORT || 80; //port Number
app.listen(port, () => console.log(`Listening on port ${port}`));



function detectAccountAvailCount(sUsername){
  return new Promise((resolve, reject) => {

    // 检测计数
    const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
    let oData = db.get(checkUserQuery, [sUsername], (err, row) => {
      if (err) {
        reject(new Error(`detectAccountAvailCount failed:${err.message}`));
      }

      if((row.count||0) <= 0){
        reject(new Error('当前无提问额度，请充值！'));
      }
      resolve(row.count);
    });
  });
}