        // Calculate generation levels using BOTH child and descent relationships
        const generations = new Map();
        const spouses = new Map();  // person -> first spouse (for generation calculations)
        const allSpouses = new Map(); // person -> array of all spouses
        const parentToChild = new Map(); // parent -> [(child, genGap)]

        // Build marriage maps
        familyData.links.forEach(link => {
            if (link.type === 'marriage') {
                // For generation calculations, just use first spouse
                if (!spouses.has(link.source)) {
                    spouses.set(link.source, link.target);
                }
                if (!spouses.has(link.target)) {
                    spouses.set(link.target, link.source);
                }

                // Track all spouses for positioning
                if (!allSpouses.has(link.source)) {
                    allSpouses.set(link.source, []);
                }
                if (!allSpouses.has(link.target)) {
                    allSpouses.set(link.target, []);
                }
                allSpouses.get(link.source).push(link.target);
                allSpouses.get(link.target).push(link.source);
            }
        });

        // Build parent-child map with generation gaps
        familyData.links.forEach(link => {
            if (link.type === 'child') {
                // Direct child = 1 generation gap
                if (!parentToChild.has(link.source)) {
                    parentToChild.set(link.source, []);
                }
                parentToChild.get(link.source).push({ child: link.target, gap: 1 });
            } else if (link.type === 'descent') {
                // Parse the label to estimate generation gap
                const label = link.label || '';
                let gap = link.gap || 4; // default gap for descendants

                // Extract number of generations from label like "~4 generations"
                const match = !link.gap && label.match(/~?(\d+)\s+generation/);
                if (match) {
                    gap = parseInt(match[1]);
                }

                if (!parentToChild.has(link.source)) {
                    parentToChild.set(link.source, []);
                }
                parentToChild.get(link.source).push({ child: link.target, gap: gap });
            }
        });

        // Find roots (people who are nobody's child)
        const allPeople = new Set(familyData.nodes.map(n => n.id));
        const allChildren = new Set();
        parentToChild.forEach((children) => {
            children.forEach(({child}) => allChildren.add(child));
        });
        const roots = [...allPeople].filter(id => !allChildren.has(id));

        // Assign generation 0 to roots
        roots.forEach(root => generations.set(root, 0));

        // BFS to assign generations with proper gaps
        function assignGenerations() {
            let changed = true;
            let iterations = 0;
            const maxIterations = 50;

            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;

                // Process all parent-child relationships
                parentToChild.forEach((children, parent) => {
                    if (generations.has(parent)) {
                        const parentGen = generations.get(parent);
                        children.forEach(({child, gap}) => {
                            const childGen = parentGen + gap;
                            if (!generations.has(child) || generations.get(child) !== childGen) {
                                generations.set(child, childGen);
                                changed = true;

                                // Spouse should be same generation
                                if (spouses.has(child)) {
                                    const spouse = spouses.get(child);
                                    if (!generations.has(spouse) || generations.get(spouse) !== childGen) {
                                        generations.set(spouse, childGen);
                                        changed = true;
                                    }
                                }
                            }
                        });
                    }
                });

                // Ensure spouses are same generation
                spouses.forEach((spouse, person) => {
                    if (generations.has(person) && generations.has(spouse)) {
                        const personGen = generations.get(person);
                        const spouseGen = generations.get(spouse);
                        if (personGen !== spouseGen) {
                            const maxGen = Math.max(personGen, spouseGen);
                            generations.set(person, maxGen);
                            generations.set(spouse, maxGen);
                            changed = true;
                        }
                    }
                });

                // Ensure siblings are same generation
                familyData.links.forEach(link => {
                    if (link.type === 'sibling') {
                        if (generations.has(link.source) && generations.has(link.target)) {
                            const gen1 = generations.get(link.source);
                            const gen2 = generations.get(link.target);
                            if (gen1 !== gen2) {
                                const maxGen = Math.max(gen1, gen2);
                                generations.set(link.source, maxGen);
                                generations.set(link.target, maxGen);
                                changed = true;
                            }
                        }
                    }
                });
            }
        }

        assignGenerations();

        // Compact generations - remove gaps
        // Convert generation numbers like [0, 1, 16, 20, 21, 23, 25, ...] to [0, 1, 2, 3, 4, 5, ...]
        const uniqueGenerations = [...new Set(generations.values())].sort((a, b) => a - b);
        const generationMapping = new Map();
        uniqueGenerations.forEach((gen, index) => {
            generationMapping.set(gen, index);
        });

        // Remap all generations to compacted values
        generations.forEach((gen, person) => {
            generations.set(person, generationMapping.get(gen));
        });

        // Build elements
        const elements = [];
        const marriageMap = new Map(); // person -> first spouse (for simple checks)
        const allMarriages = new Map(); // person -> array of all spouses

        familyData.links.forEach(link => {
            if (link.type === 'marriage') {
                // Track first spouse for simple checks
                if (!marriageMap.has(link.source)) {
                    marriageMap.set(link.source, link.target);
                }
                if (!marriageMap.has(link.target)) {
                    marriageMap.set(link.target, link.source);
                }

                // Track all spouses
                if (!allMarriages.has(link.source)) {
                    allMarriages.set(link.source, []);
                }
                if (!allMarriages.has(link.target)) {
                    allMarriages.set(link.target, []);
                }
                allMarriages.get(link.source).push(link.target);
                allMarriages.get(link.target).push(link.source);
            }
        });

        // Add nodes
        familyData.nodes.forEach(node => {
            const gen = generations.get(node.id) || 0;
            const nodeData = {
                id: node.id,
                label: node.link_to_family ? node.name : `${node.name}\nc. ${node.year}`,
                name: node.name,
                year: node.year,
                chapter: node.chapter,
                role: node.role,
                portrait: node.portrait,
                page: node.page,
                generation: gen
            };

            // Add link_to_family flag if this is a family link node
            if (node.link_to_family) {
                nodeData.link_to_family = node.link_to_family;
            }

            elements.push({ data: nodeData });
        });

        // Add edges - only one parent-child edge per child, only one descent edge per descendant
        const processedChildren = new Set();
        const processedDescendants = new Set();

        familyData.links.forEach(link => {
            const edgeData = {
                id: `${link.source}-${link.target}-${link.type}`,
                source: link.source,
                target: link.target,
                type: link.type
            };

            if (link.label) {
                edgeData.label = link.label;
            }

            if (link.adopted) {
                edgeData.adopted = true;
            }

            if (link.type === 'child') {
                // Only draw one edge per child (from first parent)
                if (!processedChildren.has(link.target)) {
                    elements.push({ data: edgeData });
                    processedChildren.add(link.target);
                }
            } else if (link.type === 'descent') {
                // Only draw one edge per descendant (from first ancestor)
                if (!processedDescendants.has(link.target)) {
                    elements.push({ data: edgeData });
                    processedDescendants.add(link.target);
                }
            } else {
                // marriage, sibling - draw all
                elements.push({ data: edgeData });
            }
        });

        // Initialize Cytoscape with preset layout
        const cy = cytoscape({
            container: document.getElementById('cy'),
            elements: elements,
            userZoomingEnabled: false,
            userPanningEnabled: false,
            boxSelectionEnabled: false,
            style: [
                {
                    selector: 'node',
                    style: {
                        'width': 180,
                        'height': 180,
                        'background-color': '#fff',
                        'background-opacity': 0.9,
                        'background-image': function(ele) {
                            return ele.data('portrait') ? ele.data('portrait') : 'none';
                        },
                        'background-fit': 'cover',
                        'background-clip': 'node',
                        'border-width': 3,
                        'border-color': '#666',
                        'label': 'data(label)',
                        'text-valign': 'bottom',
                        'text-halign': 'center',
                        'text-margin-y': 10,
                        'font-size': 14,
                        'font-weight': 'bold',
                        'color': '#4a4a4a',
                        'text-wrap': 'wrap',
                        'text-max-width': 160,
                        'shape': 'ellipse',
                        'text-background-color': '#faf8f5',
                        'text-background-opacity': 0.6,
                        'text-background-padding': 5,
                        'text-background-shape': 'round-rectangle'
                    }
                },
                {
                    selector: 'node[link_to_family]',
                    style: {
                        'width': 90,
                        'height': 90,
                        'background-color': '#fff',
                        'background-opacity': 1,
                        'background-image': function(ele) {
                            const family = ele.data('link_to_family');
                            if (!family) return 'none';
                            // Capitalize first letter of family name for the new naming scheme
                            const familyName = family.charAt(0).toUpperCase() + family.slice(1);
                            return `./images/families/sm/${familyName}.png`;
                        },
                        'background-fit': 'cover',
                        'background-clip': 'node',
                        'border-width': 3,
                        'border-color': '#8b4513',
                        'shape': 'roundrectangle',
                        'label': 'data(label)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'text-margin-y': 0,
                        'font-size': 12,
                        'font-weight': 'bold',
                        'color': '#000',
                        'text-wrap': 'wrap',
                        'text-max-width': 80,
                        'text-background-color': 'transparent',
                        'text-background-opacity': 0,
                        'text-background-padding': 0
                    }
                },
                {
                    selector: 'node:selected',
                    style: {
                        'border-width': 5,
                        'border-color': '#8b4513'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 3,
                        'curve-style': 'bezier',
                        'target-arrow-shape': 'triangle',
                        'arrow-scale': 1.5
                    }
                },
                {
                    selector: 'edge[type="marriage"]',
                    style: {
                        'line-color': '#8b6914',
                        'target-arrow-color': '#8b6914',
                        'target-arrow-shape': 'none',
                        'label': '⚭',
                        'font-size': 20,
                        'color': '#8b6914',
                        'text-margin-y': -10,
                        'width': 4
                    }
                },
                {
                    selector: 'edge[type="sibling"]',
                    style: {
                        'line-color': '#999',
                        'line-style': 'dashed',
                        'target-arrow-shape': 'none',
                        'width': 2
                    }
                },
                {
                    selector: 'edge[type="child"]',
                    style: {
                        'line-color': '#666',
                        'target-arrow-color': '#666',
                        'target-arrow-shape': 'triangle'
                    }
                },
                {
                    selector: 'edge[type="child"][adopted]',
                    style: {
                        'line-color': '#666',
                        'line-style': 'dashed',
                        'target-arrow-color': '#666',
                        'target-arrow-shape': 'triangle',
                        'label': 'Adopted',
                        'font-size': 11,
                        'color': '#666',
                        'text-background-color': '#f5f5dc',
                        'text-background-opacity': 0.9,
                        'text-background-padding': 5,
                        'text-border-width': 1,
                        'text-border-color': '#999',
                        'text-border-opacity': 0.8
                    }
                },
                {
                    selector: 'edge[type="descent"]',
                    style: {
                        'line-color': '#666',
                        'line-style': 'dashed',
                        'target-arrow-color': '#666',
                        'target-arrow-shape': 'triangle',
                        'label': 'data(label)',
                        'font-size': 11,
                        'color': '#666',
                        'text-background-color': '#f5f5dc',
                        'text-background-opacity': 0.9,
                        'text-background-padding': 5,
                        'text-border-width': 1,
                        'text-border-color': '#999',
                        'text-border-opacity': 0.8
                    }
                }
            ]
        });

        // Group nodes by generation
        const nodesByGeneration = new Map();
        cy.nodes().forEach(node => {
            const gen = node.data('generation');
            if (!nodesByGeneration.has(gen)) {
                nodesByGeneration.set(gen, []);
            }
            nodesByGeneration.get(gen).push(node);
        });

        // Build layout customization lookups from familyData.layout
        const layoutCouples = new Map(); // Maps person ID to their layout rule
        const layoutSingles = (familyData.layout && familyData.layout.singles) || {};

        if (familyData.layout && familyData.layout.couples) {
            familyData.layout.couples.forEach(rule => {
                layoutCouples.set(rule.person1, rule);
                layoutCouples.set(rule.person2, rule);
            });
        }

        // Position nodes by generation
        const verticalSpacing = 350;
        const horizontalSpacing = 300;
        const coupleSpacing = 220;
        const startY = 250;
        const nodePositions = new Map(); // Store positions for alignment

        nodesByGeneration.forEach((nodes, gen) => {
            const y = startY + (gen * verticalSpacing);

            // Sort nodes by year to maintain some chronological order
            nodes.sort((a, b) => {
                const yearA = parseInt(a.data('year')) || 0;
                const yearB = parseInt(b.data('year')) || 0;
                return yearA - yearB;
            });

            // Group married couples together
            const positioned = new Set();
            let x = 300;

            nodes.forEach(node => {
                if (positioned.has(node.id())) return;

                // Check if this person has multiple spouses
                const nodeSpouses = allMarriages.get(node.id()) || [];
                const spousesInGen = nodeSpouses.filter(s => nodes.find(n => n.id() === s));

                // Check if any of our spouses has multiple marriages - if so, skip and let them handle positioning
                let spouseHasMultiple = false;
                for (const spouseId of spousesInGen) {
                    const spouseMarriages = allMarriages.get(spouseId) || [];
                    const spouseSpousesInGen = spouseMarriages.filter(s => nodes.find(n => n.id() === s));
                    if (spouseSpousesInGen.length > 1) {
                        spouseHasMultiple = true;
                        break;
                    }
                }
                if (spouseHasMultiple) return; // Skip, let the spouse with multiple marriages handle it

                if (spousesInGen.length > 1) {
                    // Handle multiple marriages - position all spouses around this person
                    // Person goes in center, spouses on sides based on layout rules

                    // Find which spouse goes left and which goes right, and check for offset
                    let leftSpouse = null, rightSpouse = null;
                    let groupOffset = 0;

                    spousesInGen.forEach(spouseId => {
                        const rule = layoutCouples.get(spouseId);
                        if (rule && rule.person2 === node.id()) {
                            // This spouse is person1 in a rule with our node as person2
                            if (rule.person1_side === 'left') {
                                leftSpouse = spouseId;
                            } else if (rule.person1_side === 'right') {
                                rightSpouse = spouseId;
                            }
                            // Get offset from any rule
                            if (rule.offset) {
                                groupOffset = rule.offset;
                            }
                        }
                    });

                    // Fallback: use declaration order if no rules
                    if (!leftSpouse && !rightSpouse) {
                        leftSpouse = spousesInGen[0];
                        rightSpouse = spousesInGen[1];
                    } else if (!leftSpouse) {
                        leftSpouse = spousesInGen.find(s => s !== rightSpouse);
                    } else if (!rightSpouse) {
                        rightSpouse = spousesInGen.find(s => s !== leftSpouse);
                    }

                    // Position: leftSpouse - node - rightSpouse (with group offset)
                    const leftNode = cy.getElementById(leftSpouse);
                    const rightNode = cy.getElementById(rightSpouse);

                    leftNode.position({ x: x + groupOffset, y: y });
                    nodePositions.set(leftSpouse, x + groupOffset);
                    positioned.add(leftSpouse);

                    node.position({ x: x + groupOffset + coupleSpacing, y: y });
                    nodePositions.set(node.id(), x + groupOffset + coupleSpacing);
                    positioned.add(node.id());

                    rightNode.position({ x: x + groupOffset + coupleSpacing * 2, y: y });
                    nodePositions.set(rightSpouse, x + groupOffset + coupleSpacing * 2);
                    positioned.add(rightSpouse);

                    x += coupleSpacing * 2 + horizontalSpacing + groupOffset;
                } else {
                    const spouse = marriageMap.get(node.id());
                    if (spouse && nodes.find(n => n.id() === spouse)) {
                    // Position couple side by side
                    const spouseNode = cy.getElementById(spouse);

                    // Check for layout customization
                    const layoutRule = layoutCouples.get(node.id());
                    let xOffset = (layoutRule && layoutRule.offset) || 0;
                    let yOffset = (layoutRule && layoutRule.y_offset) || 0;

                    // Check for special alignment
                    if (layoutRule && layoutRule.align_with) {
                        const alignX = nodePositions.get(layoutRule.align_with) || (x + xOffset);

                        // Determine left and right person
                        let leftPerson, rightPerson, leftId, rightId;
                        if (layoutRule.person1_side === 'left') {
                            if (node.id() === layoutRule.person1) {
                                leftPerson = node;
                                leftId = node.id();
                                rightPerson = spouseNode;
                                rightId = spouse;
                            } else {
                                leftPerson = spouseNode;
                                leftId = spouse;
                                rightPerson = node;
                                rightId = node.id();
                            }
                        } else {
                            // Default: first person processed goes left
                            leftPerson = node;
                            leftId = node.id();
                            rightPerson = spouseNode;
                            rightId = spouse;
                        }

                        leftPerson.position({ x: alignX - coupleSpacing, y: y + yOffset });
                        nodePositions.set(leftId, alignX - coupleSpacing);
                        positioned.add(leftId);
                        rightPerson.position({ x: alignX, y: y + yOffset });
                        nodePositions.set(rightId, alignX);
                        positioned.add(rightId);
                    } else {
                        // Standard positioning (possibly with offset)
                        let leftPerson, rightPerson, leftId, rightId;

                        // Determine left and right based on layout rule
                        if (layoutRule && layoutRule.person1_side) {
                            if (layoutRule.person1_side === 'left') {
                                if (node.id() === layoutRule.person1) {
                                    leftPerson = node;
                                    leftId = node.id();
                                    rightPerson = spouseNode;
                                    rightId = spouse;
                                } else {
                                    leftPerson = spouseNode;
                                    leftId = spouse;
                                    rightPerson = node;
                                    rightId = node.id();
                                }
                            } else {
                                if (node.id() === layoutRule.person1) {
                                    rightPerson = node;
                                    rightId = node.id();
                                    leftPerson = spouseNode;
                                    leftId = spouse;
                                } else {
                                    rightPerson = spouseNode;
                                    rightId = spouse;
                                    leftPerson = node;
                                    leftId = node.id();
                                }
                            }
                        } else {
                            // Default: first person processed goes left
                            leftPerson = node;
                            leftId = node.id();
                            rightPerson = spouseNode;
                            rightId = spouse;
                        }

                        // Check if offset anchors on specific person
                        const anchorPerson = (layoutRule && layoutRule.anchor) || null;
                        if (anchorPerson === rightId) {
                            // Offset anchors on right person
                            rightPerson.position({ x: x + xOffset, y: y + yOffset });
                            nodePositions.set(rightId, x + xOffset);
                            positioned.add(rightId);
                            leftPerson.position({ x: x + xOffset - coupleSpacing, y: y + yOffset });
                            nodePositions.set(leftId, x + xOffset - coupleSpacing);
                            positioned.add(leftId);
                        } else {
                            // Offset anchors on left person (default)
                            leftPerson.position({ x: x + xOffset, y: y + yOffset });
                            nodePositions.set(leftId, x + xOffset);
                            positioned.add(leftId);
                            rightPerson.position({ x: x + xOffset + coupleSpacing, y: y + yOffset });
                            nodePositions.set(rightId, x + xOffset + coupleSpacing);
                            positioned.add(rightId);
                        }
                    }

                    x += coupleSpacing + horizontalSpacing;
                    } else {
                        // Position single person
                        const singleLayout = layoutSingles[node.id()];
                        let xOffset = 0;
                        let yOffset = 0;

                        // Support both number (legacy) and object format
                        if (typeof singleLayout === 'number') {
                            xOffset = singleLayout;
                        } else if (singleLayout && typeof singleLayout === 'object') {
                            xOffset = singleLayout.offset || 0;
                            yOffset = singleLayout.y_offset || 0;
                        }

                        const nodeX = x + xOffset;

                        node.position({ x: nodeX, y: y + yOffset });
                        nodePositions.set(node.id(), nodeX);
                        positioned.add(node.id());
                        x += horizontalSpacing;
                    }
                }
            });
        });

        // Special positioning for link nodes - move them closer to their descendants
        cy.nodes('[link_to_family]').forEach(linkNode => {
            // Find descendant(s) of this link node
            const linkId = linkNode.id();
            const descendants = familyData.links.filter(link =>
                link.source === linkId && link.type === 'descent'
            );

            if (descendants.length > 0) {
                const descendantId = descendants[0].target;
                const descendantNode = cy.getElementById(descendantId);

                if (descendantNode) {
                    const descendantPos = descendantNode.position();
                    const linkPos = linkNode.position();

                    // Position link node 175px above the descendant
                    linkNode.position({
                        x: linkPos.x,
                        y: descendantPos.y - 175
                    });
                }
            }
        });

        // Handle node clicks
        cy.on('tap', 'node', function(evt) {
            const node = evt.target;
            const page = node.data('page');
            if (page) {
                window.location.href = page;
            }
        });

        // Add pointer cursor on hover
        cy.on('mouseover', 'node', function(evt) {
            document.body.style.cursor = 'pointer';
        });

        cy.on('mouseout', 'node', function(evt) {
            document.body.style.cursor = 'default';
        });

        // Function to update zoom and pan based on container width
        function updateZoomAndPan() {
            const allNodes = cy.nodes();
            const bbox = allNodes.boundingBox();
            const containerWidth = cy.width();
            const bboxWidth = bbox.x2 - bbox.x1;

            // Calculate zoom to fit width with padding (leave 5% on each side)
            const padding = containerWidth * 0.05;
            const targetWidth = containerWidth - (padding * 2);
            const zoomLevel = Math.min(targetWidth / bboxWidth, 1); // Never zoom past 1

            // Apply zoom
            cy.zoom(zoomLevel);

            // Pan to center horizontally and position at top
            // After zoom, coordinates are in model space, but pan needs to account for zoom
            const bboxCenterX = (bbox.x1 + bbox.x2) / 2;
            const containerCenterX = containerWidth / 2;
            const panX = containerCenterX - (bboxCenterX * zoomLevel);
            const panY = 20 - (bbox.y1 * zoomLevel);

            cy.pan({ x: panX, y: panY });

            // Update chapter overlays based on zoom level
            updateChapterOverlays(zoomLevel);

            return zoomLevel;
        }

        // Function to create/update chapter overlays
        function updateChapterOverlays(zoomLevel) {
            const container = document.querySelector('.container');

            // Remove existing overlays
            const existingOverlays = container.querySelectorAll('.chapter-overlay');
            existingOverlays.forEach(overlay => overlay.remove());

            // Only create chapter overlays if zoom level is 1 (they don't align at other zoom levels)
            if (zoomLevel === 1) {
                const chapterMap = new Map();

                // Group nodes by chapter and find y-position ranges (exclude link nodes)
                cy.nodes().forEach(node => {
                    const chapter = node.data('chapter');
                    const isLinkNode = node.data('link_to_family');

                    // Skip link nodes - they don't have chapters
                    if (chapter && !isLinkNode) {
                        if (!chapterMap.has(chapter)) {
                            chapterMap.set(chapter, {
                                minY: Infinity,
                                maxY: -Infinity,
                                title: '',
                                subtitle: ''
                            });
                        }
                        const pos = node.position();
                        const chapterData = chapterMap.get(chapter);
                        chapterData.minY = Math.min(chapterData.minY, pos.y);
                        chapterData.maxY = Math.max(chapterData.maxY, pos.y);
                    }
                });

                // Add chapter titles and subtitles
                familyData.chapters.forEach(ch => {
                    if (chapterMap.has(ch.id)) {
                        const data = chapterMap.get(ch.id);
                        data.title = ch.title;
                        data.subtitle = ch.subtitle;
                    }
                });

                // Create overlay elements
                const pan = cy.pan();
                const headerHeight = document.querySelector('header').offsetHeight;

                chapterMap.forEach((data, chapterId) => {
                    const overlay = document.createElement('div');
                    overlay.className = 'chapter-overlay';
                    overlay.textContent = data.title;

                    // Calculate position relative to the container, accounting for pan offset
                    // Subtract node radius (90px) to align better with the generation
                    const containerTop = data.minY + pan.y + headerHeight - 90;
                    const containerBottom = data.maxY + pan.y + headerHeight + 90;
                    const height = containerBottom - containerTop;

                    overlay.style.top = `${containerTop}px`;
                    overlay.style.height = `${height}px`;

                    container.appendChild(overlay);

                    // Auto-shrink font if text doesn't fit (for vertical text, scrollHeight is the text width)
                    // We need to check after a brief delay to ensure rendering is complete
                    setTimeout(() => {
                        let fontSize = parseFloat(window.getComputedStyle(overlay).fontSize);
                        const minFontSize = 12; // Don't go below 12px

                        // For vertical text, scrollWidth represents the height needed for the text
                        // and offsetWidth represents the container width (42px)
                        while (overlay.scrollWidth > overlay.offsetWidth && fontSize > minFontSize) {
                            fontSize -= 0.5;
                            overlay.style.fontSize = fontSize + 'px';
                        }
                    }, 100);
                });
            }
        }

        // Set initial container height
        const allNodes = cy.nodes();
        const bbox = allNodes.boundingBox();
        const requiredHeight = (bbox.y2 - bbox.y1) + 400; // 200px padding top & bottom
        const cyElement = document.getElementById('cy');
        cyElement.style.height = `${requiredHeight}px`;

        // Initial zoom and pan
        updateZoomAndPan();

        // Update zoom on window resize with debouncing
        let resizeTimer;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function() {
                updateZoomAndPan();
            }, 250); // Wait 250ms after resize stops before recalculating
        });
