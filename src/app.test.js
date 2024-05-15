import {
  jest,
  test,
  expect,
  describe,
  beforeAll,
  afterAll,
} from "@jest/globals";
import request from "supertest";
import app from "./app";
import { read, write } from "./tools/json-files";

// Reset the data files before and after running the tests
beforeAll(() => {
  write("game-runs", []);
});
afterAll(() => {
  write("game-runs", []);
});

async function fetchToken(userName, password) {
  const response = await request(app)
    .post("/authenticate")
    .auth(userName, password)
    .expect(200);
  return response.body.token;
}

describe("POST /authenticate", () => {
  it("should return JWT on successful authentication", async () => {
    const response = await request(app)
      .post("/authenticate")
      .auth("Iris", "123")
      .expect(200);

    expect(response.body).toEqual({ token: expect.any(String) });
  });

  it("should return 401 Unauthorized on failed authentication", async () => {
    await request(app)
      .post("/authenticate")
      .auth("Iris", "1233")
      .expect(401, "Unauthorized");
  });
});

describe("GET /questions", () => {
  it("should return the properties id, question, and options of all questions stored in data/questions.json", async () => {
    const response = await request(app).get("/questions").expect(200);
    const questions = read("questions");

    expect(response.body).toEqual(
      questions.map(({ id, question, options }) => ({ id, question, options }))
    );
  });
});

describe("GET /questions/{questionId}", () => {
  it("should return the properties id, question, and options for a specific question by its UUID", async () => {
    const questions = read("questions");
    const question = questions[0];

    const response = await request(app)
      .get(`/questions/${question.id}`)
      .expect(200);

    expect(response.body).toEqual({
      id: question.id,
      question: question.question,
      options: question.options,
    });
  });

  it("should return 404 Not Found if the specified ID does not exist", async () => {
    await request(app).get("/questions/oops").expect(404, "Not Found");
  });
});

describe("POST /game-runs", () => {
  it("should return 401 Unauthorized if no JWT is provided", async () => {
    await request(app).post("/game-runs").expect(401, "Unauthorized");
  });

  it("should return a UUID as the runId on successful creation", async () => {
    const userName = "Max";
    const token = await fetchToken(userName, "123");

    const response = await request(app)
      .post("/game-runs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({ runId: expect.any(String) });

    const gameRuns = read("game-runs");
    const newRun = gameRuns.find((run) => run.id === response.body.runId);

    expect(newRun).toEqual({
      id: response.body.runId,
      userName,
      createdAt: expect.any(Number),
      responses: {},
    });
  });
});

describe("PUT /game-runs/{runId}/responses", () => {
  it("should return 404 Not Found if the specified ID does not exist", async () => {
    const token = await fetchToken("Max", "123");
    await request(app)
      .put("/game-runs/oops/responses")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("should return 401 Unauthorized if no JWT is provided", async () => {
    await request(app).put("/game-runs/runId/responses").expect(401);
  });

  it("should return 403 Forbidden if the game run does not belong to the logged-in user", async () => {
    const irisToken = await fetchToken("Iris", "123");

    // Create a game run with Iris
    const runId = await request(app)
      .post("/game-runs")
      .set("Authorization", `Bearer ${irisToken}`)
      .expect(200)
      .then((response) => response.body.runId);

    const maxToken = await fetchToken("Max", "123");

    await request(app)
      .put(`/game-runs/${runId}/responses`)
      .set("Authorization", `Bearer ${maxToken}`)
      .expect(403);
  });

  it("should return 400 Bad Request if the passed question id is invalid", async () => {
    const token = await fetchToken("Iris", "123");
    const gameRun = read("game-runs").at(-1);

    await request(app)
      .put(`/game-runs/${gameRun.id}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({ oops: 0 })
      .expect(400);
  });

  it("should return 400 Bad Request if the passed response value is invalid", async () => {
    const token = await fetchToken("Iris", "123");

    const gameRun = read("game-runs").at(-1);
    const lastQuestion = read("questions").at(-1);

    await request(app)
      .put(`/game-runs/${gameRun.id}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({ [lastQuestion.id]: 4 })
      .expect(400);
  });

  it("should update the responses of the specified game run", async () => {
    const token = await fetchToken("Iris", "123");
    const gameRun = read("game-runs").at(-1);
    const lastQuestion = read("questions").at(-1);

    await request(app)
      .put(`/game-runs/${gameRun.id}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({ [lastQuestion.id]: 3 })
      .expect(200);

    const updatedGameRun = read("game-runs").find(
      (run) => run.id === gameRun.id
    );
    expect(updatedGameRun.responses).toEqual({ [lastQuestion.id]: 3 });
  });
});

describe("GET /game-runs/{runId}/results", () => {
  it("should return 404 Not Found if the specified ID does not exist", async () => {
    const token = await fetchToken("Max", "123");
    await request(app)
      .get("/game-runs/oops/results")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("should return 401 Unauthorized if no JWT is provided", async () => {
    await request(app).get("/game-runs/runId/results").expect(401);
  });

  it("should return 403 Forbidden if the game run does not belong to the logged-in user", async () => {
    const irisToken = await fetchToken("Iris", "123");

    // Create a game run with Iris
    const runId = await request(app)
      .post("/game-runs")
      .set("Authorization", `Bearer ${irisToken}`)
      .expect(200)
      .then((response) => response.body.runId);

    const maxToken = await fetchToken("Max", "123");

    await request(app)
      .get(`/game-runs/${runId}/results`)
      .set("Authorization", `Bearer ${maxToken}`)
      .expect(403);
  });

  it("should return the results of the specified game run", async () => {
    const token = await fetchToken("Iris", "123");

    // Create a game run
    const runId = await request(app)
      .post("/game-runs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .then((response) => response.body.runId);

    // Put 3 responses - 2 correct, 1 incorrect
    const questions = read("questions");

    await request(app)
      .put(`/game-runs/${runId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        [questions[0].id]: questions[0].correctAnswer,
        [questions[1].id]: questions[1].correctAnswer,
        [questions[2].id]: 0,
      })
      .expect(200);

    const response = await request(app)
      .get(`/game-runs/${runId}/results`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      id: runId,
      userName: "Iris",
      createdAt: expect.any(Number),
      responses: {
        [questions[0].id]: true,
        [questions[1].id]: true,
        [questions[2].id]: false,
      },
    });
  });
});
