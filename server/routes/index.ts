import { Router } from "express";
import analysisRoutes from "./analysis";
import eventsRoutes from "./events";
import batchRoutes from "./batch";
import tagsRoutes from "./tags";
import systemRoutes from "./system";
import newsRoutes from "./news";

const router = Router();

router.use(analysisRoutes);
router.use(eventsRoutes);
router.use(batchRoutes);
router.use(tagsRoutes);
router.use(systemRoutes);
router.use(newsRoutes);

export default router;




