import express from "express";
import passport from "passport";
import { BasicStrategy } from "passport-http";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { read, write } from "./tools/json-files.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import Joi from "joi";

const app = express();
app.use(express.json());

const JWT_SECRET = "super-secret";

// Basic strategy for POST /authenticate endpoint
passport.use(
  new BasicStrategy(async function (userName, password, done) {
    const users = read("users");
    const user = users.find((user) => user.userName === userName);

    if (!user) {
      // User not found
      done(null, false);
      return;
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      // Password incorrect
      done(null, false);
      return;
    }

    done(null, user);
  })
);

// JWT strategy
passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: JWT_SECRET,
    },
    (jwtPayload, done) => {
      done(null, {
        userName: jwtPayload.userName,
      });
    }
  )
);

// Checks if the game run is is owned by logged in user
function gameOwnerMiddleware(req, res, next) {
  if (!req.user) {
    res.sendStatus(401);
    return;
  }

  const gameRuns = read("game-runs");
  const gameRun = gameRuns.find((gameRun) => gameRun.id === req.params.runId);

  if (!gameRun) {
    res.sendStatus(404);
    return;
  }

  if (gameRun.userName === req.user.userName) {
    next();
  } else {
    res.sendStatus(403);
  }
}

// POST /authenticate
app.post(
  "/authenticate",
  passport.authenticate("basic", { session: false }),
  (req, res) => {
    const token = jwt.sign({ userName: req.user.userName }, JWT_SECRET, {
      subject: req.user.userName,
    });

    res.send({ token });
  }
);

// GET /questions
app.get("/questions", (req, res) => {
  const questions = read("questions");

  res.send(
    questions.map(({ id, question, options }) => ({ id, question, options }))
  );
});

// GET /questions/{questionId}
app.get("/questions/:questionId", (req, res) => {
  const questions = read("questions");
  const question = questions.find(
    (question) => question.id === req.params.questionId
  );

  if (!question) {
    res.sendStatus(404);
    return;
  }

  delete question.correctAnswer;

  res.send(question);
});

// POST /game-runs
app.post(
  "/game-runs",
  passport.authenticate("jwt", { session: false }),
  (req, res) => {
    const runId = uuidv4();

    write("game-runs", [
      ...read("game-runs"),
      {
        id: runId,
        userName: req.user.userName,
        createdAt: new Date().getTime(),
        responses: {},
      },
    ]);

    res.send({ runId });
  }
);

// PUT /game-runs/{runId}/responses
const questions = read("questions");
const questionIds = questions.map((question) => question.id);
const putGameRunResponsesSchema = Joi.object()
  .pattern(
    Joi.string().valid(...questionIds),
    Joi.number().integer().min(0).max(3).required().strict()
  )
  .min(1);

app.put(
  "/game-runs/:runId/responses",
  passport.authenticate("jwt", { session: false }),
  gameOwnerMiddleware,
  (req, res) => {
    const gameRuns = read("game-runs");
    const gameRun = gameRuns.find((gameRun) => gameRun.id === req.params.runId);

    if (!gameRun) {
      res.sendStatus(404);
      return;
    }

    const { error, value } = putGameRunResponsesSchema.validate(req.body);
    if (error) {
      res.status(400).send({ error });
      return;
    }

    gameRun.responses = value;

    write(
      "game-runs",
      gameRuns.map((gameRun) =>
        gameRun.id === req.params.runId ? gameRun : gameRun
      )
    );

    res.sendStatus(200);
  }
);

// GET /game-runs/{runId}/results
app.get(
  "/game-runs/:runId/results",
  passport.authenticate("jwt", { session: false }),
  gameOwnerMiddleware,
  (req, res) => {
    const gameRuns = read("game-runs");
    const gameRun = gameRuns.find((gameRun) => gameRun.id === req.params.runId);
    if (!gameRun) {
      res.sendStatus(404);
      return;
    }

    const { id, userName, createdAt, responses } = gameRun;
    
    res.send({
      id,
      userName,
      createdAt,
      responses: Object.fromEntries(
        Object.entries(responses).map(([questionId, answerIndex]) => {
          const question = questions.find(
            (question) => question.id === questionId
          );
          return [questionId, question.correctAnswer === answerIndex];
        })
      ),
    });
  }
);

export default app;
