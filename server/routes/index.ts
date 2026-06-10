import { Router } from "express";
import analysisRoutes from "./analysis";
import eventsRoutes from "./events";
import batchRoutes from "./batch";
import tagsRoutes from "./tags";
import systemRoutes from "./system";
import newsRoutes from "./news";
import agentReviewRoutes from "./agent-review";
import mainEventsCheckRoutes from "./main-events-check";

const router = Router();

router.use(analysisRoutes);
router.use(eventsRoutes);
router.use(batchRoutes);
router.use(tagsRoutes);
router.use(systemRoutes);
router.use(newsRoutes);
router.use(agentReviewRoutes);
router.use(mainEventsCheckRoutes);

export default router;




