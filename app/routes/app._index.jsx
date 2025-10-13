import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  Button,
  TextField,
  Select,
  Checkbox,
  InlineStack,
  Badge,
  DataTable,
  EmptyState,
  Modal,
  FormLayout,
  ChoiceList,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";

export default function BroadcastCenter() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [message, setMessage] = useState("");
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [audienceType, setAudienceType] = useState("all");
  const [scheduledDate, setScheduledDate] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);

  // Mock data for campaigns
  const [campaigns] = useState([
    {
      id: 1,
      name: "Black Friday Sale",
      message: "Get 50% off everything! Use code BLACKFRIDAY",
      channels: ["web", "whatsapp"],
      status: "sent",
      sentAt: "2024-01-15 10:30 AM",
      recipients: 1250,
    },
    {
      id: 2,
      name: "New Product Launch",
      message: "Check out our latest collection now available!",
      channels: ["web"],
      status: "scheduled",
      sentAt: "2024-01-20 2:00 PM",
      recipients: 800,
    },
    {
      id: 3,
      name: "Cart Abandonment",
      message: "Don't forget about your items! Complete your purchase now.",
      channels: ["whatsapp"],
      status: "draft",
      sentAt: null,
      recipients: 0,
    },
  ]);

  const channelOptions = [
    { label: "Web Chat", value: "web" },
    { label: "WhatsApp", value: "whatsapp" },
  ];

  const audienceOptions = [
    { label: "All customers", value: "all" },
    { label: "Active customers", value: "active" },
    { label: "VIP customers", value: "vip" },
    { label: "Cart abandoners", value: "abandoned" },
  ];

  const handleCreateCampaign = useCallback(() => {
    setShowCreateModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowCreateModal(false);
    setCampaignName("");
    setMessage("");
    setSelectedChannels([]);
    setAudienceType("all");
    setScheduledDate("");
    setIsScheduled(false);
  }, []);

  const handleSaveCampaign = useCallback(() => {
    // Here you would save the campaign to your backend
    console.log("Saving campaign:", {
      name: campaignName,
      message,
      channels: selectedChannels,
      audience: audienceType,
      scheduled: isScheduled ? scheduledDate : null,
    });
    handleCloseModal();
  }, [campaignName, message, selectedChannels, audienceType, isScheduled, scheduledDate, handleCloseModal]);

  const getStatusBadge = (status) => {
    const statusMap = {
      sent: { status: "success", children: "Sent" },
      scheduled: { status: "attention", children: "Scheduled" },
      draft: { status: "info", children: "Draft" },
    };
    return <Badge {...statusMap[status]} />;
  };

  const getChannelBadges = (channels) => {
    return channels.map((channel) => (
      <Badge key={channel} status="info">
        {channel === "web" ? "Web" : "WhatsApp"}
      </Badge>
    ));
  };

  const rows = campaigns.map((campaign) => [
    campaign.name,
    campaign.message.substring(0, 50) + (campaign.message.length > 50 ? "..." : ""),
    getChannelBadges(campaign.channels),
    getStatusBadge(campaign.status),
    campaign.recipients.toLocaleString(),
    campaign.sentAt || "Not sent",
  ]);

  return (
    <Page>
      <TitleBar title="Broadcast Center">
        <Button primary onClick={handleCreateCampaign}>
          Create Campaign
        </Button>
      </TitleBar>
      
      <BlockStack gap="500">
        {/* Stats Overview */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Total Campaigns
                </Text>
                <Text as="p" variant="heading2xl">
                  {campaigns.length}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Messages Sent
                </Text>
                <Text as="p" variant="heading2xl">
                  {campaigns.reduce((sum, c) => sum + c.recipients, 0).toLocaleString()}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Active Campaigns
                </Text>
                <Text as="p" variant="heading2xl">
                  {campaigns.filter(c => c.status === "scheduled").length}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Campaigns Table */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Campaigns
              </Text>
              <Button onClick={handleCreateCampaign}>
                New Campaign
              </Button>
            </InlineStack>
            
            {campaigns.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                headings={["Name", "Message", "Channels", "Status", "Recipients", "Sent At"]}
                rows={rows}
              />
            ) : (
              <EmptyState
                heading="No campaigns yet"
                action={{
                  content: "Create your first campaign",
                  onAction: handleCreateCampaign,
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Start building your customer engagement with targeted campaigns.</p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Create Campaign Modal */}
      <Modal
        open={showCreateModal}
        onClose={handleCloseModal}
        title="Create New Campaign"
        primaryAction={{
          content: "Create Campaign",
          onAction: handleSaveCampaign,
          disabled: !campaignName || !message || selectedChannels.length === 0,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseModal,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Campaign Name"
              value={campaignName}
              onChange={setCampaignName}
              placeholder="e.g., Black Friday Sale"
              autoComplete="off"
            />
            
            <TextField
              label="Message"
              value={message}
              onChange={setMessage}
              multiline={4}
              placeholder="Enter your message here..."
              helpText="Keep it concise and engaging for better results"
            />
            
            <ChoiceList
              title="Channels"
              choices={channelOptions}
              selected={selectedChannels}
              onChange={setSelectedChannels}
              allowMultiple
            />
            
            <Select
              label="Audience"
              options={audienceOptions}
              value={audienceType}
              onChange={setAudienceType}
            />
            
            <Checkbox
              label="Schedule for later"
              checked={isScheduled}
              onChange={setIsScheduled}
            />
            
            {isScheduled && (
              <TextField
                label="Schedule Date & Time"
                type="datetime-local"
                value={scheduledDate}
                onChange={setScheduledDate}
              />
            )}
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
