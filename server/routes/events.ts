import { Router } from "express";

import { storage } from "../storage";
import { insertManualNewsEntrySchema } from "@shared/schema";

const router = Router();

router.post("/api/manual-entries", async (req, res) => {
  try {
    const validatedData = insertManualNewsEntrySchema.parse(req.body);
    
    // Check if a manual entry already exists for this date
    const existingEntries = await storage.getManualEntriesByDate(validatedData.date);
    if (existingEntries.length > 0) {
      return res.status(409).json({ error: "Manual entry already exists for this date" });
    }
    
    const entry = await storage.createManualEntry(validatedData);
    res.json(entry);
  } catch (error) {
    if ((error as any).name === 'ZodError') {
      return res.status(400).json({ error: "Invalid input data", details: (error as any).errors });
    }
    // Check for unique constraint violation
    if ((error as any).code === '23505' || (error as any).message?.includes('unique constraint')) {
      return res.status(409).json({ error: "Manual entry already exists for this date" });
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/manual-entries/date/:date", async (req, res) => {
  try {
    const { date } = req.params;
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }

    const entries = await storage.getManualEntriesByDate(date);
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/manual-entries/all", async (req, res) => {
  try {
    const entries = await storage.getAllManualEntries();
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put("/api/manual-entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const entry = await storage.updateManualEntry(id, updateData);
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/manual-entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await storage.deleteManualEntry(id);
    res.json({ message: "Manual entry deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
