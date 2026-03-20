import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
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
    createWork,
    deleteWork,
    getAssignableUsers,
    getWork,
    updateWork,
} from "../api/ministry";
import PageShell from "../components/PageShell";

const SORTABLE_COLUMNS = {
    name: "name",
    requestDate: "request_date",
};

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function createEmptyForm() {
    return {
        dateFulfilled: "",
        deaconUserId: "",
        isFulfilled: false,
        name: "",
        request: "",
        requestDate: todayIsoDate(),
    };
}

function normalizeDateValue(value) {
    return value ? String(value).slice(0, 10) : "";
}

function compareValues(sortBy, direction) {
    const multiplier = direction === "asc" ? 1 : -1;
    return (a, b) => {
        const left = String(a[sortBy] || "").toLowerCase();
        const right = String(b[sortBy] || "").toLowerCase();

        if (left < right) {
            return -1 * multiplier;
        }
        if (left > right) {
            return 1 * multiplier;
        }
        return 0;
    };
}

function openNativeDatePicker(event) {
    if (typeof event.target.showPicker === "function") {
        event.target.showPicker();
    }
}

function Work() {
    const [items, setItems] = useState([]);
    const [users, setUsers] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [hideFulfilled, setHideFulfilled] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [sortBy, setSortBy] = useState(SORTABLE_COLUMNS.requestDate);
    const [sortDirection, setSortDirection] = useState("desc");
    const [form, setForm] = useState(createEmptyForm());

    async function loadData() {
        setLoading(true);
        setError("");
        try {
            const [work, assignableUsers] = await Promise.all([getWork(), getAssignableUsers()]);
            setItems(work);
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

        const payload = {
            dateFulfilled: form.dateFulfilled || null,
            deaconUserId: form.deaconUserId ? Number(form.deaconUserId) : null,
            isFulfilled: form.isFulfilled,
            name: form.name,
            request: form.request,
            requestDate: form.requestDate,
        };

        try {
            if (editingId) {
                await updateWork(editingId, payload);
            } else {
                await createWork(payload);
            }
            setIsModalOpen(false);
            setEditingId(null);
            setForm(createEmptyForm());
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    function startEdit(item) {
        setEditingId(item.id);
        setForm({
            dateFulfilled: normalizeDateValue(item.date_fulfilled),
            deaconUserId: item.deacon_user_id ? String(item.deacon_user_id) : "",
            isFulfilled: item.is_fulfilled,
            name: item.name || "",
            request: item.request || "",
            requestDate: normalizeDateValue(item.request_date),
        });
        setIsModalOpen(true);
    }

    async function handleDelete(id) {
        try {
            await deleteWork(id);
            setIsModalOpen(false);
            setEditingId(null);
            setForm(createEmptyForm());
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    function openCreateModal() {
        setEditingId(null);
        setForm(createEmptyForm());
        setError("");
        setIsModalOpen(true);
    }

    function closeModal() {
        if (saving) {
            return;
        }
        setIsModalOpen(false);
        setEditingId(null);
        setForm(createEmptyForm());
    }

    function handleSort(column) {
        if (sortBy === column) {
            setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
            return;
        }

        setSortBy(column);
        setSortDirection(column === SORTABLE_COLUMNS.name ? "asc" : "desc");
    }

    function handleFulfilledToggle(checked) {
        setForm((prev) => ({
            ...prev,
            dateFulfilled: checked ? prev.dateFulfilled || todayIsoDate() : "",
            isFulfilled: checked,
        }));
    }

    const visibleItems = items
        .filter((item) => (hideFulfilled ? !item.is_fulfilled : true))
        .slice()
        .sort(compareValues(sortBy, sortDirection));

    return (
        <PageShell
            eyebrow="Service"
            title="Work Requests"
            description="Track work requests, assignment, and fulfillment progress."
        >
            {loading ? <Typography>Loading work requests...</Typography> : null}
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            <Box className="hero-card" sx={{ mb: 2 }}>
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
                    <Button variant="contained" onClick={openCreateModal}>New Request</Button>
                    <FormControlLabel
                        control={<Switch checked={hideFulfilled} onChange={(event) => setHideFulfilled(event.target.checked)} />}
                        label="Hide Fulfilled Requests"
                    />
                </Stack>
            </Box>

            <TableContainer className="hero-card">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>
                                <TableSortLabel
                                    active={sortBy === SORTABLE_COLUMNS.name}
                                    direction={sortBy === SORTABLE_COLUMNS.name ? sortDirection : "asc"}
                                    onClick={() => handleSort(SORTABLE_COLUMNS.name)}
                                >
                                    Name
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={sortBy === SORTABLE_COLUMNS.requestDate}
                                    direction={sortBy === SORTABLE_COLUMNS.requestDate ? sortDirection : "desc"}
                                    onClick={() => handleSort(SORTABLE_COLUMNS.requestDate)}
                                >
                                    Request Date
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>Request</TableCell>
                            <TableCell>Assigned</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {visibleItems.map((item) => (
                            <TableRow key={item.id} hover>
                                <TableCell>{item.name || "-"}</TableCell>
                                <TableCell>{normalizeDateValue(item.request_date) || "-"}</TableCell>
                                <TableCell>{item.request}</TableCell>
                                <TableCell>{item.deacon_email || "Unassigned"}</TableCell>
                                <TableCell>{item.is_fulfilled ? "Fulfilled" : "Open"}</TableCell>
                                <TableCell align="right">
                                    <Button size="small" variant="outlined" onClick={() => startEdit(item)}>Edit</Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {!loading && visibleItems.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6}>
                                    <Typography variant="body2" color="text.secondary">No work requests match the current filter.</Typography>
                                </TableCell>
                            </TableRow>
                        ) : null}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={isModalOpen} onClose={closeModal} fullWidth maxWidth="sm">
                <Box component="form" onSubmit={handleSubmit}>
                    <DialogTitle>{editingId ? "Edit Work Request" : "New Work Request"}</DialogTitle>
                    <DialogContent className="form-stack" sx={{ overflowY: "visible", pt: 2 }}>
                        <TextField
                            label="Name"
                            InputLabelProps={{ shrink: true }}
                            value={form.name}
                            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                            required
                            autoFocus
                        />
                        <TextField
                            label="Request"
                            InputLabelProps={{ shrink: true }}
                            value={form.request}
                            onChange={(event) => setForm((prev) => ({ ...prev, request: event.target.value }))}
                            required
                            multiline
                            minRows={2}
                        />
                        <TextField
                            label="Request Date"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            inputProps={{ onClick: openNativeDatePicker }}
                            value={form.requestDate}
                            onChange={(event) => setForm((prev) => ({ ...prev, requestDate: event.target.value }))}
                            required
                        />
                        <TextField
                            select
                            label="Deacon / Yokefellow"
                            InputLabelProps={{ shrink: true }}
                            helperText="Optional"
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
                        <FormControlLabel
                            control={<Switch checked={form.isFulfilled} onChange={(event) => handleFulfilledToggle(event.target.checked)} />}
                            label="Fulfilled"
                        />
                        <TextField
                            label="Date Fulfilled"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            inputProps={{ onClick: openNativeDatePicker }}
                            value={form.dateFulfilled}
                            onChange={(event) => setForm((prev) => ({ ...prev, dateFulfilled: event.target.value }))}
                            disabled={!form.isFulfilled}
                        />
                    </DialogContent>
                    <DialogActions>
                        {editingId ? (
                            <Button color="error" onClick={() => handleDelete(editingId)} disabled={saving}>
                                Delete
                            </Button>
                        ) : null}
                        <Button onClick={closeModal} disabled={saving}>Cancel</Button>
                        <Button type="submit" variant="contained" disabled={saving}>{saving ? "Saving..." : editingId ? "Update" : "Create"}</Button>
                    </DialogActions>
                </Box>
            </Dialog>
        </PageShell>
    );
}

export default Work;
