import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
    createWidow,
    deleteWidow,
    getAssignableUsers,
    getWidows,
    updateWidow,
} from "../api/ministry";
import PageShell from "../components/PageShell";

function Widows() {
    const [widows, setWidows] = useState([]);
    const [users, setUsers] = useState([]);
    const [form, setForm] = useState({ deaconUserId: "", latestNotes: "", location: "", name: "", type: "Widowed" });
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [sortBy, setSortBy] = useState("name");
    const [sortDirection, setSortDirection] = useState("asc");
    const [searchText, setSearchText] = useState("");
    const [typeFilter, setTypeFilter] = useState("all");
    const [assignmentFilter, setAssignmentFilter] = useState("all");

    async function loadData() {
        setLoading(true);
        setError("");

        try {
            const [widowData, assignableUsers] = await Promise.all([
                getWidows(),
                getAssignableUsers(),
            ]);
            setWidows(widowData);
            setUsers(assignableUsers);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        try {
            const payload = {
                deaconUserId: form.deaconUserId ? Number(form.deaconUserId) : null,
                latestNotes: form.latestNotes,
                location: form.location,
                name: form.name,
                type: form.type,
            };

            if (editingId) {
                await updateWidow(editingId, payload);
            } else {
                await createWidow(payload);
            }

            setForm({ deaconUserId: "", latestNotes: "", location: "", name: "", type: "Widowed" });
            setEditingId(null);
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id) {
        try {
            await deleteWidow(id);
            if (editingId === id) {
                setEditingId(null);
                setForm({ deaconUserId: "", latestNotes: "", location: "", name: "", type: "Widowed" });
            }
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    function startEdit(item) {
        setEditingId(item.id);
        setForm({
            deaconUserId: item.deacon_user_id ? String(item.deacon_user_id) : "",
            latestNotes: item.latest_notes || "",
            location: item.location || "",
            name: item.name,
            type: item.type || "Widowed",
        });

        if (typeof window !== "undefined") {
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    }

    function handleSort(column) {
        if (sortBy === column) {
            setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
            return;
        }

        setSortBy(column);
        setSortDirection("asc");
    }

    const filteredAndSortedWidows = useMemo(() => {
        const normalizedSearch = searchText.trim().toLowerCase();

        const filteredWidows = widows.filter((item) => {
            if (typeFilter !== "all" && (item.type || "Widowed") !== typeFilter) {
                return false;
            }

            if (assignmentFilter === "assigned" && !item.deacon_user_id) {
                return false;
            }

            if (assignmentFilter === "unassigned" && item.deacon_user_id) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            return Object.values(item)
                .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
        });

        return filteredWidows.sort((left, right) => {
            const leftValue =
                sortBy === "assigned"
                    ? (left.deacon_name || left.deacon_email || "Unassigned").toLowerCase()
                    : (left.name || "").toLowerCase();
            const rightValue =
                sortBy === "assigned"
                    ? (right.deacon_name || right.deacon_email || "Unassigned").toLowerCase()
                    : (right.name || "").toLowerCase();

            if (leftValue === rightValue) {
                return 0;
            }

            const comparison = leftValue.localeCompare(rightValue);
            return sortDirection === "asc" ? comparison : -comparison;
        });
    }, [assignmentFilter, searchText, sortBy, sortDirection, typeFilter, widows]);

    const summaryCounts = useMemo(() => {
        const total = filteredAndSortedWidows.length;
        const homeBound = filteredAndSortedWidows.filter((item) => item.type === "Home Bound").length;
        const widowed = filteredAndSortedWidows.filter((item) => (item.type || "Widowed") === "Widowed").length;
        const assigned = filteredAndSortedWidows.filter((item) => Boolean(item.deacon_user_id)).length;

        return {
            assigned,
            homeBound,
            total,
            widowed,
        };
    }, [filteredAndSortedWidows]);

    return (
        <PageShell
            eyebrow="Care"
            title="Widows"
            description="Add, modify, or remove widow care records."
        >
            <Box component="form" className="hero-card form-stack" onSubmit={handleSubmit} sx={{ mb: 2 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                    label="Name"
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                />
                <TextField
                    select
                    label="Type"
                    value={form.type}
                    onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                >
                    <MenuItem value="Widowed">Widowed</MenuItem>
                    <MenuItem value="Home Bound">Home Bound</MenuItem>
                </TextField>
                <TextField
                    label="Location"
                    value={form.location}
                    onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                />
                <TextField
                    select
                    label="Deacon / Yokefellow"
                    value={form.deaconUserId}
                    onChange={(event) => setForm((prev) => ({ ...prev, deaconUserId: event.target.value }))}
                >
                    <MenuItem value="">Unassigned</MenuItem>
                    {users.map((user) => (
                        <MenuItem key={user.id} value={String(user.id)}>
                            {user.name || user.email} ({user.email})
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    label="Latest Notes"
                    multiline
                    minRows={3}
                    value={form.latestNotes}
                    onChange={(event) => setForm((prev) => ({ ...prev, latestNotes: event.target.value }))}
                />
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={saving}>
                        {saving ? "Saving..." : editingId ? "Update widow" : "Add widow"}
                    </Button>
                    {editingId ? (
                        <Button
                            type="button"
                            color="error"
                            variant="outlined"
                            onClick={() => handleDelete(editingId)}
                        >
                            Remove
                        </Button>
                    ) : null}
                    {editingId ? (
                        <Button
                            type="button"
                            variant="outlined"
                            onClick={() => {
                                setEditingId(null);
                                setForm({ deaconUserId: "", latestNotes: "", location: "", name: "", type: "Widowed" });
                            }}
                        >
                            Cancel edit
                        </Button>
                    ) : null}
                </Stack>
            </Box>

            {loading ? <Typography>Loading widows...</Typography> : null}
            <Box className="hero-card" sx={{ mb: 2 }}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                    <TextField
                        label="Search"
                        placeholder="Search all fields"
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                        fullWidth
                    />
                    <TextField
                        select
                        label="Type Filter"
                        value={typeFilter}
                        onChange={(event) => setTypeFilter(event.target.value)}
                        sx={{ minWidth: 180 }}
                    >
                        <MenuItem value="all">All Types</MenuItem>
                        <MenuItem value="Widowed">Widowed</MenuItem>
                        <MenuItem value="Home Bound">Home Bound</MenuItem>
                    </TextField>
                    <TextField
                        select
                        label="Assigned Filter"
                        value={assignmentFilter}
                        onChange={(event) => setAssignmentFilter(event.target.value)}
                        sx={{ minWidth: 180 }}
                    >
                        <MenuItem value="all">All Assignments</MenuItem>
                        <MenuItem value="assigned">Assigned</MenuItem>
                        <MenuItem value="unassigned">Unassigned</MenuItem>
                    </TextField>
                </Stack>
            </Box>
            <TableContainer className="hero-card" sx={{ p: 0, overflowX: "auto" }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sortDirection={sortBy === "name" ? sortDirection : false}>
                                <TableSortLabel
                                    active={sortBy === "name"}
                                    direction={sortBy === "name" ? sortDirection : "asc"}
                                    onClick={() => handleSort("name")}
                                >
                                    Name
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell sortDirection={sortBy === "assigned" ? sortDirection : false}>
                                <TableSortLabel
                                    active={sortBy === "assigned"}
                                    direction={sortBy === "assigned" ? sortDirection : "asc"}
                                    onClick={() => handleSort("assigned")}
                                >
                                    Assigned
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>Latest Notes</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {filteredAndSortedWidows.map((item) => (
                            <TableRow key={item.id} hover>
                                <TableCell>{item.name}</TableCell>
                                <TableCell>{item.type || "Widowed"}</TableCell>
                                <TableCell>{item.deacon_name || "Unassigned"}</TableCell>
                                <TableCell>{item.latest_notes || ""}</TableCell>
                                <TableCell align="right">
                                    <Button size="small" variant="outlined" onClick={() => startEdit(item)}>Edit</Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {!loading && filteredAndSortedWidows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5}>
                                    <Typography variant="body2">No matching widow records.</Typography>
                                </TableCell>
                            </TableRow>
                        ) : null}
                        <TableRow>
                            <TableCell colSpan={5}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    Total records: {summaryCounts.total} | Widowed: {summaryCounts.widowed} | Home Bound: {summaryCounts.homeBound} | Assigned {summaryCounts.assigned} of {summaryCounts.total}
                                </Typography>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>
        </PageShell>
    );
}

export default Widows;
