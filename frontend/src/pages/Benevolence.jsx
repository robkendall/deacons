import { useEffect, useMemo, useState } from "react";
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
    createBenevolence,
    deleteBenevolence,
    getAssignableUsers,
    getBenevolence,
    updateBenevolence,
} from "../api/ministry";
import PageShell from "../components/PageShell";

const SORTABLE_COLUMNS = {
    amount: "amount",
    name: "name",
    requestDate: "request_date",
};

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function createEmptyForm() {
    return {
        amount: "0",
        dateFilled: "",
        deaconUserId: "",
        isFilled: false,
        name: "",
        request: "",
        requestDate: todayIsoDate(),
    };
}

function compareValues(a, b, field, direction) {
    const valA = a[field] ?? "";
    const valB = b[field] ?? "";
    const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true });
    return direction === "asc" ? cmp : -cmp;
}

function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
    }).format(value);
}

function normalizeDateValue(raw) {
    if (!raw) return "";
    return String(raw).slice(0, 10);
}

function openNativeDatePicker(event) {
    try {
        event.target.showPicker();
    } catch {
        // Not all browsers support showPicker
    }
}

function Benevolence() {
    const [items, setItems] = useState([]);
    const [users, setUsers] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [hideFilled, setHideFilled] = useState(false);
    const [sortBy, setSortBy] = useState(SORTABLE_COLUMNS.requestDate);
    const [sortDirection, setSortDirection] = useState("desc");
    const [form, setForm] = useState(createEmptyForm());

    async function loadData() {
        setLoading(true);
        setError("");
        try {
            const [benevolence, assignableUsers] = await Promise.all([
                getBenevolence(),
                getAssignableUsers(),
            ]);
            setItems(benevolence);
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

    const sortedItems = useMemo(() => {
        const filtered = hideFilled ? items.filter((item) => !item.is_filled) : items;
        return [...filtered].sort((a, b) => compareValues(a, b, sortBy, sortDirection));
    }, [items, hideFilled, sortBy, sortDirection]);

    function handleSortChange(column) {
        if (sortBy === column) {
            setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortBy(column);
            setSortDirection("asc");
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        const hasDeaconUserId =
            form.deaconUserId !== undefined &&
            form.deaconUserId !== null &&
            form.deaconUserId !== "";
        const deaconUserId = hasDeaconUserId ? Number(form.deaconUserId) : null;

        const payload = {
            amount: Number(form.amount),
            dateFilled: form.dateFilled || null,
            deaconUserId,
            isFilled: form.isFilled,
            name: form.name,
            request: form.request,
            requestDate: form.requestDate,
        };

        try {
            if (editingId) {
                await updateBenevolence(editingId, payload);
            } else {
                await createBenevolence(payload);
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

    function openNewModal() {
        setEditingId(null);
        setForm(createEmptyForm());
        setError("");
        setIsModalOpen(true);
    }

    function openEditModal(item) {
        setEditingId(item.id);
        setError("");
        setForm({
            amount: String(item.amount),
            dateFilled: normalizeDateValue(item.date_filled),
            deaconUserId: item.deacon_user_id ? String(item.deacon_user_id) : "",
            isFilled: item.is_filled,
            name: item.name,
            request: item.request,
            requestDate: normalizeDateValue(item.request_date),
        });
        setIsModalOpen(true);
    }

    function closeModal() {
        if (saving) return;
        setIsModalOpen(false);
        setEditingId(null);
        setForm(createEmptyForm());
        setError("");
    }

    function handleFilledToggle(checked) {
        setForm((prev) => ({
            ...prev,
            isFilled: checked,
            dateFilled: checked && !prev.dateFilled ? todayIsoDate() : checked ? prev.dateFilled : "",
        }));
    }

    async function handleDelete() {
        try {
            await deleteBenevolence(editingId);
            closeModal();
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <PageShell
            eyebrow="Care"
            title="Benevolence"
            description="Track benevolence requests, amounts, fill status, and follow-up dates."
        >
            {loading ? <Typography>Loading benevolence...</Typography> : null}
            <Box className="hero-card" sx={{ mb: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: error ? 2 : 1 }}>
                    <Button variant="contained" onClick={openNewModal}>
                        New Request
                    </Button>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={hideFilled}
                                onChange={(e) => setHideFilled(e.target.checked)}
                            />
                        }
                        label="Hide Filled"
                        labelPlacement="start"
                    />
                </Stack>
                {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>
                                    <TableSortLabel
                                        active={sortBy === SORTABLE_COLUMNS.name}
                                        direction={sortBy === SORTABLE_COLUMNS.name ? sortDirection : "asc"}
                                        onClick={() => handleSortChange(SORTABLE_COLUMNS.name)}
                                    >
                                        Name
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={sortBy === SORTABLE_COLUMNS.requestDate}
                                        direction={sortBy === SORTABLE_COLUMNS.requestDate ? sortDirection : "asc"}
                                        onClick={() => handleSortChange(SORTABLE_COLUMNS.requestDate)}
                                    >
                                        Date
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={sortBy === SORTABLE_COLUMNS.amount}
                                        direction={sortBy === SORTABLE_COLUMNS.amount ? sortDirection : "asc"}
                                        onClick={() => handleSortChange(SORTABLE_COLUMNS.amount)}
                                    >
                                        Amount
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>Assigned</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {sortedItems.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} align="center">
                                        No requests found.
                                    </TableCell>
                                </TableRow>
                            ) : sortedItems.map((item) => (
                                <TableRow key={item.id} hover>
                                    <TableCell>{item.name}</TableCell>
                                    <TableCell>{normalizeDateValue(item.request_date)}</TableCell>
                                    <TableCell>{formatCurrency(item.amount)}</TableCell>
                                    <TableCell>{item.deacon_email || "—"}</TableCell>
                                    <TableCell>{item.is_filled ? "Filled" : "Open"}</TableCell>
                                    <TableCell>
                                        <Button size="small" variant="outlined" onClick={() => openEditModal(item)}>
                                            Edit
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>

            <Dialog open={isModalOpen} onClose={closeModal} fullWidth maxWidth="sm">
                <DialogTitle>{editingId ? "Edit Request" : "New Request"}</DialogTitle>
                <Box component="form" onSubmit={handleSubmit}>
                    <DialogContent className="form-stack" sx={{ overflowY: "visible", pt: 2 }}>
                        {error ? <Alert severity="error">{error}</Alert> : null}
                        <TextField
                            label="Name"
                            value={form.name}
                            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            required
                        />
                        <TextField
                            label="Request"
                            value={form.request}
                            onChange={(e) => setForm((p) => ({ ...p, request: e.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            multiline
                            minRows={2}
                            required
                        />
                        <TextField
                            label="Request Date"
                            type="date"
                            value={form.requestDate}
                            onChange={(e) => setForm((p) => ({ ...p, requestDate: e.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            inputProps={{ onClick: openNativeDatePicker }}
                            required
                        />
                        <TextField
                            label="Amount"
                            type="number"
                            inputProps={{ min: "0", step: "0.01" }}
                            value={form.amount}
                            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            required
                        />
                        <TextField
                            select
                            label="Deacon / Yokefellow"
                            value={form.deaconUserId}
                            onChange={(e) => setForm((p) => ({ ...p, deaconUserId: e.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            helperText="Optional"
                        >
                            <MenuItem value="">Unassigned</MenuItem>
                            {users.map((user) => (
                                <MenuItem key={user.id} value={String(user.id)}>
                                    {user.name || user.email} ({user.email})
                                </MenuItem>
                            ))}
                        </TextField>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={form.isFilled}
                                    onChange={(e) => handleFilledToggle(e.target.checked)}
                                />
                            }
                            label="Filled"
                        />
                        <TextField
                            label="Date Filled"
                            type="date"
                            value={form.dateFilled}
                            onChange={(e) => setForm((p) => ({ ...p, dateFilled: e.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            inputProps={{ onClick: openNativeDatePicker }}
                            disabled={!form.isFilled}
                        />
                    </DialogContent>
                    <DialogActions>
                        {editingId ? (
                            <Button color="error" onClick={handleDelete} disabled={saving}>
                                Delete
                            </Button>
                        ) : null}
                        <Box sx={{ flex: 1 }} />
                        <Button onClick={closeModal} disabled={saving}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="contained" disabled={saving}>
                            {saving ? "Saving..." : editingId ? "Update" : "Add"}
                        </Button>
                    </DialogActions>
                </Box>
            </Dialog>
        </PageShell>
    );
}

export default Benevolence;
