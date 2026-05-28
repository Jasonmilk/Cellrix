use crate::{LayoutError, LayoutRect};

/// Type of slot constraint.
#[derive(Debug, Clone, PartialEq)]
pub enum SlotType {
    Percentage(f64),
    FixedLines(u16),
    Min(u16),
}

/// Assignment of a slot to a physical rectangle.
#[derive(Debug, Clone)]
pub struct SlotAssignment {
    pub slot_id: String,
    pub rect: LayoutRect,
    pub node_ids: Vec<String>,
}

/// Allocates screen space to slots.
pub struct SlotAllocator;

impl SlotAllocator {
    pub fn new() -> Self {
        Self
    }

    pub fn allocate_slots(
        &self,
        total_width: u16,
        total_height: u16,
        slot_types: &[SlotType],
        weights: &[f64],
    ) -> Result<Vec<(String, LayoutRect)>, LayoutError> {
        if slot_types.is_empty() {
            return Err(LayoutError::NoSpace);
        }
        if slot_types.len() != weights.len() {
            return Err(LayoutError::InvalidGrid(
                "slot_types and weights length mismatch".to_string(),
            ));
        }

        let mut remaining_height = total_height as i32;
        let mut y = 0u16;
        let mut results = Vec::new();
        let mut flexible = Vec::new(); // (index, slot_id, base_height)

        // First pass: allocate fixed and min slots.
        for (idx, slot_type) in slot_types.iter().enumerate() {
            let slot_id = format!("slot_{}", idx);
            match slot_type {
                SlotType::FixedLines(lines) => {
                    let height = *lines;
                    if remaining_height < height as i32 {
                        return Err(LayoutError::NoSpace);
                    }
                    results.push((
                        slot_id,
                        LayoutRect {
                            x: 0,
                            y,
                            width: total_width,
                            height,
                        },
                    ));
                    y += height;
                    remaining_height -= height as i32;
                }
                SlotType::Min(min) => {
                    let height = *min;
                    if remaining_height < height as i32 {
                        return Err(LayoutError::NoSpace);
                    }
                    flexible.push((idx, slot_id, height as i32));
                }
                SlotType::Percentage(_) => {
                    flexible.push((idx, slot_id, 0));
                }
            }
        }

        // Distribute remaining space among flexible slots.
        let total_weight: f64 = flexible.iter().map(|(idx, _, _)| weights[*idx]).sum();
        if total_weight > 0.0 && remaining_height > 0 {
            for (idx, slot_id, base_height) in flexible {
                let weight = weights[idx];
                let extra = ((remaining_height as f64) * (weight / total_weight)).floor() as i32;
                let total_h = base_height + extra;
                if total_h > 0 {
                    results.push((
                        slot_id,
                        LayoutRect {
                            x: 0,
                            y,
                            width: total_width,
                            height: total_h as u16,
                        },
                    ));
                    y += total_h as u16;
                }
            }
        } else {
            for (_, slot_id, base_height) in flexible {
                if base_height > 0 {
                    results.push((
                        slot_id,
                        LayoutRect {
                            x: 0,
                            y,
                            width: total_width,
                            height: base_height as u16,
                        },
                    ));
                    y += base_height as u16;
                }
            }
        }

        Ok(results)
    }
}

impl Default for SlotAllocator {
    fn default() -> Self {
        Self::new()
    }
}
