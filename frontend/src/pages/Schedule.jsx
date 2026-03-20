import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";

import {
    createSchedule,
    deleteSchedule,
    getSchedule,
    updateSchedule,
} from "../api/ministry";
import PageShell from "../components/PageShell";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_OPTIONS = [
    { label: "January", value: "01" },
    { label: "February", value: "02" },
    { label: "March", value: "03" },
    { label: "April", value: "04" },
    { label: "May", value: "05" },
    { label: "June", value: "06" },
    { label: "July", value: "07" },
    { label: "August", value: "08" },
    { label: "September", value: "09" },
    { label: "October", value: "10" },
    { label: "November", value: "11" },
    { label: "December", value: "12" },
];

function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function monthBounds(monthValue) {
    const [year, month] = monthValue.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    return { firstDay, lastDay };
}

function formatDateKey(date) {
    return date.toISOString().slice(0, 10);
}

function buildMonthValue(year, monthPart) {
    return `${year}-${monthPart}`;
}

function monthLabel(monthPart) {
    const option = MONTH_OPTIONS.find((monthOption) => monthOption.value === monthPart);
    return option ? option.label : monthPart;
}

function Schedule() {
    const [entries, setEntries] = useState([]);
    const [month, setMonth] = useState(currentMonthValue());
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({
        details: "",
        entryDate: todayIsoDate(),
        title: "",
    });

    const [selectedYear, selectedMonthPart] = month.split("-");
    const yearOptions = useMemo(() => {
        const baseYear = new Date().getFullYear();
        const years = [];
        for (let year = baseYear - 5; year <= baseYear + 5; year += 1) {
            years.push(String(year));
        }

        if (!years.includes(selectedYear)) {
            years.push(selectedYear);
            years.sort();
        }

        return years;
    }, [selectedYear]);

    async function loadData(activeMonth) {
        setLoading(true);
        setError("");

        try {
            const scheduleEntries = await getSchedule(activeMonth);
            setEntries(scheduleEntries);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData(month);
    }, [month]);

    const entriesByDate = useMemo(() => {
        const grouped = {};
        for (const entry of entries) {
            const dateKey = String(entry.entry_date).slice(0, 10);
            if (!grouped[dateKey]) {
                grouped[dateKey] = [];
            }
            grouped[dateKey].push(entry);
        }

        return grouped;
    }, [entries]);

    const calendarCells = useMemo(() => {
        const { firstDay, lastDay } = monthBounds(month);
        const startWeekday = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

        const cells = [];
        for (let index = 0; index < totalCells; index += 1) {
            const dayNumber = index - startWeekday + 1;
            const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;

            if (!inMonth) {
                cells.push({
                    date: null,
                    dateKey: `blank-${index}`,
                    dayNumber: null,
                    inMonth: false,
                });
                continue;
            }

            const date = new Date(firstDay.getFullYear(), firstDay.getMonth(), dayNumber);
            cells.push({
                date,
                dateKey: formatDateKey(date),
                dayNumber,
                inMonth: true,
            });
        }

        return cells;
    }, [month]);

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        const payload = {
            details: form.details,
            entryDate: form.entryDate,
            title: form.title,
        };

        try {
            if (editingId) {
                await updateSchedule(editingId, payload);
            } else {
                await createSchedule(payload);
            }

            setEditingId(null);
            setForm({ details: "", entryDate: todayIsoDate(), title: "" });
            setIsModalOpen(false);
            await loadData(month);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    function startEdit(entry) {
        setEditingId(entry.id);
        setIsModalOpen(true);
        setForm({
            details: entry.details || "",
            entryDate: String(entry.entry_date).slice(0, 10),
            title: entry.title,
        });
    }

    async function handleDelete(id) {
        try {
            await deleteSchedule(id);
            setEditingId(null);
            setForm({ details: "", entryDate: todayIsoDate(), title: "" });
            setIsModalOpen(false);
            await loadData(month);
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    function startNewEntry(dateKey) {
        setEditingId(null);
        setIsModalOpen(true);
        setForm({
            details: "",
            entryDate: dateKey || todayIsoDate(),
            title: "",
        });
    }

    function cancelEditor() {
        if (saving) {
            return;
        }

        setEditingId(null);
        setIsModalOpen(false);
        setForm({ details: "", entryDate: todayIsoDate(), title: "" });
    }

    function shiftMonth(delta) {
        const [year, monthPart] = month.split("-").map(Number);
        const next = new Date(year, monthPart - 1 + delta, 1);
        setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    }

    return (
        <PageShell
            eyebrow="Planning"
            title="Schedule"
            description="Monthly calendar view for schedule entries. Click on a date to add an entry or click an existing entry to edit."
        >
            <Box className="hero-card form-stack" sx={{ mb: 2 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <IconButton type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" color="primary">
                        <ChevronLeftRoundedIcon />
                    </IconButton>
                    <Typography variant="h6">{monthLabel(selectedMonthPart)} {selectedYear}</Typography>
                    <IconButton type="button" onClick={() => shiftMonth(1)} aria-label="Next month" color="primary">
                        <ChevronRightRoundedIcon />
                    </IconButton>
                </Stack>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            select
                            label="Month"
                            value={selectedMonthPart}
                            onChange={(event) => setMonth(buildMonthValue(selectedYear, event.target.value))}
                        >
                            {MONTH_OPTIONS.map((monthOption) => (
                                <MenuItem key={monthOption.value} value={monthOption.value}>
                                    {monthOption.label}
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            label="Year"
                            value={selectedYear}
                            onChange={(event) => setMonth(buildMonthValue(event.target.value, selectedMonthPart))}
                        >
                            {yearOptions.map((year) => (
                                <MenuItem key={year} value={year}>{year}</MenuItem>
                            ))}
                        </TextField>
                    </Stack>
                    <Button variant="contained" onClick={() => startNewEntry("")}>New</Button>
                </Stack>
            </Box>

            {loading ? <Typography>Loading schedule...</Typography> : null}

            <Box className="schedule-grid-wrap">
                <Box className="schedule-grid schedule-headings">
                    {DAY_LABELS.map((label) => (
                        <Box key={label} className="schedule-heading-cell">
                            <Typography variant="overline">{label}</Typography>
                        </Box>
                    ))}
                </Box>

                <Box className="schedule-grid">
                    {calendarCells.map((cell) => {
                        if (!cell.inMonth) {
                            return <Box key={cell.dateKey} className="schedule-cell schedule-cell-empty" />;
                        }

                        const dayEntries = entriesByDate[cell.dateKey] || [];

                        return (
                            <Box key={cell.dateKey} className="schedule-cell">
                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                                    <Typography variant="subtitle2">{cell.dayNumber}</Typography>
                                    <Button
                                        size="small"
                                        variant="text"
                                        className="schedule-day-add"
                                        onClick={() => startNewEntry(cell.dateKey)}
                                    >
                                        Add
                                    </Button>
                                </Stack>
                                <Stack spacing={0.75}>
                                    {dayEntries.map((entry) => (
                                        <Box
                                            key={entry.id}
                                            className="schedule-entry-item"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => startEdit(entry)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    startEdit(entry);
                                                }
                                            }}
                                            sx={{ cursor: "pointer" }}
                                        >
                                            <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>{entry.title}</Typography>
                                            {entry.details ? (
                                                <Typography variant="caption" color="text.secondary">
                                                    {entry.details}
                                                </Typography>
                                            ) : null}
                                        </Box>
                                    ))}
                                </Stack>
                            </Box>
                        );
                    })}
                </Box>
            </Box>

            <Dialog open={isModalOpen} onClose={cancelEditor} fullWidth maxWidth="sm">
                <Box component="form" onSubmit={handleSubmit}>
                    <DialogTitle>{editingId ? "Edit Entry" : "New Entry"}</DialogTitle>
                    <DialogContent className="form-stack" sx={{ overflowY: "visible", pt: 2 }}>
                        <TextField
                            label="Title"
                            InputLabelProps={{ shrink: true }}
                            value={form.title}
                            onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
                            required
                            autoFocus
                        />
                        <TextField
                            label="Entry Date"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={form.entryDate}
                            onChange={(event) => setForm((previous) => ({ ...previous, entryDate: event.target.value }))}
                            required
                        />
                        <TextField
                            label="Details"
                            InputLabelProps={{ shrink: true }}
                            value={form.details}
                            onChange={(event) => setForm((previous) => ({ ...previous, details: event.target.value }))}
                            multiline
                            minRows={2}
                        />
                    </DialogContent>
                    <DialogActions>
                        {editingId ? (
                            <Button type="button" color="error" onClick={() => handleDelete(editingId)} disabled={saving}>
                                Delete
                            </Button>
                        ) : null}
                        <Button type="button" onClick={cancelEditor} disabled={saving}>Cancel</Button>
                        <Button type="submit" variant="contained" disabled={saving}>{saving ? "Saving..." : editingId ? "Update" : "Create"}</Button>
                    </DialogActions>
                </Box>
            </Dialog>
        </PageShell>
    );
}

export default Schedule;
