import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";

import PageShell from "../components/PageShell";

const cards = [
    {
        title: "Widow care records",
        description: "Track widow records with notes and assigned Deacon or Yokefellow.",
        action: "/widows",
    },
    {
        title: "Benevolence requests",
        description: "Record financial requests, amounts, and completion details.",
        action: "/benevolence",
    },
    {
        title: "Work requests",
        description: "Manage practical service requests and fulfillment status.",
        action: "/work",
    },
    {
        title: "Monthly schedule",
        description: "Use the month view to add and modify calendar entries.",
        action: "/schedule",
    },
    {
        title: "Information",
        description: "Store shared ministry information entries tied to an assigned user.",
        action: "/information",
    },
    {
        title: "Users management",
        description: "View every user and edit account settings.",
        action: "/users",
    },
];

function Dashboard({ user }) {
    return (
        <PageShell
            eyebrow="Overview"
            title="Deacons dashboard"
            description={`Signed in as ${user?.name || user?.email || "a starter user"}. Use these pages to manage widow care, benevolence, work, schedule, and shared information.`}
        >
            <div className="grid-cards">
                {cards.map((card) => (
                    <section key={card.action} className="route-card">
                        <div>
                            <Typography variant="h5" sx={{ mb: 1 }}>
                                {card.title}
                            </Typography>
                            <Typography variant="body1">{card.description}</Typography>
                        </div>
                        <Stack direction="row" sx={{ mt: 2 }}>
                            <Button component={RouterLink} to={card.action} variant="contained">
                                Open
                            </Button>
                        </Stack>
                    </section>
                ))}
            </div>
        </PageShell>
    );
}

export default Dashboard;
